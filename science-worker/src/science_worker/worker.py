
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import FastAPI, HTTPException

from .processor import ProcessingCancelled, ProcessingError, process_sentinel2_ndvi
from .nisar.pipeline import NISARProcessingError, process_gcov_change_pair


LOGGER = logging.getLogger("third_eye.science_worker")

BUCKET = "scientific-results"
MAX_ATTEMPTS = 3
POLL_SECONDS = 3.0
JOB_LEASE_MINUTES = 15

PROCESSING_DIRECTORY = Path(
    os.environ.get(
        "SCIENCE_PROCESSING_DIRECTORY",
        tempfile.gettempdir(),
    )
)


class WorkerSettings:
    def __init__(self) -> None:
        self.supabase_url = (
            os.environ.get("SUPABASE_URL", "")
            .strip()
            .rstrip("/")
        )

        self.service_role_key = os.environ.get(
            "SUPABASE_SERVICE_ROLE_KEY",
            "",
        ).strip()

        self.poll_seconds = max(
            1.0,
            float(
                os.environ.get(
                    "SCIENCE_WORKER_POLL_SECONDS",
                    POLL_SECONDS,
                )
            ),
        )

    @property
    def configured(self) -> bool:
        return bool(
            self.supabase_url
            and self.service_role_key
        )


class SupabaseAdmin:
    def __init__(self, settings: WorkerSettings) -> None:
        self.base_url = settings.supabase_url

        self.client = httpx.Client(
            timeout=httpx.Timeout(
                30.0,
                connect=10.0,
            ),
            headers={
                "apikey": settings.service_role_key,
                "Authorization": (
                    f"Bearer {settings.service_role_key}"
                ),
                "Accept": "application/json",
            },
        )

    def rpc(
        self,
        name: str,
        body: dict[str, Any] | None = None,
    ) -> Any:
        response = self.client.post(
            f"{self.base_url}/rest/v1/rpc/{name}",
            json=body or {},
        )

        if not response.is_success:
            error_detail = response.text[:1500]

            raise RuntimeError(
                f"Supabase RPC {name} returned "
                f"HTTP {response.status_code}: "
                f"{error_detail}"
            )

        try:
            return response.json()

        except ValueError as error:
            raise RuntimeError(
                f"Supabase RPC {name} returned invalid JSON."
            ) from error

    def get_job(self, job_id: str) -> dict[str, Any]:
        response = self.client.get(
            f"{self.base_url}/rest/v1/scientific_jobs",
            params={
                "id": f"eq.{job_id}",
                "select": (
                    "id,user_id,status,attempts,workflow_id,collection_id,item_id,"
                    "aoi_geojson,nisar_parameters,cancel_requested_at"
                ),
            },
        )

        if not response.is_success:
            raise RuntimeError(
                "Supabase job read returned "
                f"HTTP {response.status_code}: "
                f"{response.text[:1500]}"
            )

        rows = response.json()

        if (
            not isinstance(rows, list)
            or not rows
            or not isinstance(rows[0], dict)
        ):
            raise RuntimeError(
                "The claimed scientific job could not be read."
            )

        return rows[0]

    def update_job(
        self,
        job_id: str,
        values: dict[str, Any],
    ) -> None:
        response = self.client.patch(
            f"{self.base_url}/rest/v1/scientific_jobs",
            params={
                "id": f"eq.{job_id}",
            },
            json=values,
            headers={
                "Prefer": "return=minimal",
            },
        )

        if not response.is_success:
            raise RuntimeError(
                "Supabase job update returned "
                f"HTTP {response.status_code}: "
                f"{response.text[:1500]}"
            )

    def upload(
        self,
        path: str,
        file_path: Path,
        content_type: str,
    ) -> None:
        encoded_path = quote(
            path,
            safe="/",
        )

        with file_path.open("rb") as source:
            response = self.client.post(
                (
                    f"{self.base_url}/storage/v1/object/"
                    f"{BUCKET}/{encoded_path}"
                ),
                content=source,
                headers={
                    "Content-Type": content_type,
                    "x-upsert": "true",
                },
            )

        if not response.is_success:
            raise RuntimeError(
                "Supabase Storage upload returned "
                f"HTTP {response.status_code}: "
                f"{response.text[:1500]}"
            )

    def close(self) -> None:
        self.client.close()


class ScienceWorker:
    def __init__(self, settings: WorkerSettings) -> None:
        self.settings = settings
        self.admin = SupabaseAdmin(settings)
        self.stop_event = threading.Event()

    def run(self) -> None:
        LOGGER.info(
            "Scientific worker polling enabled. Poll interval: %s seconds.",
            self.settings.poll_seconds,
        )

        while not self.stop_event.is_set():
            try:
                claimed = self.admin.rpc(
                    "claim_next_scientific_job"
                )

                job = (
                    claimed[0]
                    if isinstance(claimed, list) and claimed
                    else claimed
                )

                if isinstance(job, dict) and job.get("id"):
                    LOGGER.info(
                        "Claimed scientific job %s.",
                        job["id"],
                    )

                    self.process_job(job)
                    continue

            except Exception:
                LOGGER.exception(
                    "Worker poll failed. Full diagnostic follows."
                )

            self.stop_event.wait(
                self.settings.poll_seconds
            )

        LOGGER.info("Scientific worker polling stopped.")

    def stop(self) -> None:
        self.stop_event.set()

    def _cancelled(self, job_id: str) -> bool:
        return (
            self.admin.get_job(job_id).get(
                "cancel_requested_at"
            )
            is not None
        )

    def _progress(
        self,
        job_id: str,
        stage: str,
    ) -> None:
        progress_values = {
            "discovering": 10,
            "retrieving": 25,
            "validating": 45,
            "processing": 65,
            "publishing": 85,
            "completed": 100,
        }

        if stage not in progress_values:
            raise ProcessingError(
                f"Unknown processing stage: {stage}",
                retryable=False,
            )

        now = datetime.now(timezone.utc)

        values = {
            "stage": stage,
            "progress": progress_values[stage],
            "lease_expires_at": (
                now
                + timedelta(minutes=JOB_LEASE_MINUTES)
            ).isoformat(),
            "updated_at": now.isoformat(),
        }

        self.admin.update_job(
            job_id,
            values,
        )

    @staticmethod
    def _aoi_bounds(aoi: dict[str, Any]) -> tuple[float, float, float, float]:
        if aoi.get("type") not in {"Polygon", "MultiPolygon"}:
            raise ProcessingError("NISAR processing requires a Polygon or MultiPolygon AOI.", retryable=False)
        coordinates = aoi.get("coordinates")
        points: list[tuple[float, float]] = []

        def collect(value: Any) -> None:
            if isinstance(value, (list, tuple)) and len(value) >= 2 and all(isinstance(v, (int, float)) for v in value[:2]):
                points.append((float(value[0]), float(value[1])))
            elif isinstance(value, (list, tuple)):
                for child in value:
                    collect(child)

        collect(coordinates)
        if len(points) < 4:
            raise ProcessingError("The NISAR AOI does not contain a valid polygon ring.", retryable=False)
        west = min(point[0] for point in points)
        east = max(point[0] for point in points)
        south = min(point[1] for point in points)
        north = max(point[1] for point in points)
        if west < -180 or east > 180 or south < -90 or north > 90 or west >= east or south >= north:
            raise ProcessingError("The NISAR AOI bounds are invalid.", retryable=False)
        if east - west > 2 or north - south > 2:
            raise ProcessingError("NISAR processing is limited to 2 degrees per AOI axis.", retryable=False)
        return west, south, east, north

    def _process_nisar_job(self, job: dict[str, Any], job_id: str, user_id: str) -> None:
        params = job.get("nisar_parameters")
        aoi = job.get("aoi_geojson")
        if not isinstance(params, dict) or not isinstance(aoi, dict):
            raise ProcessingError("The NISAR job is missing its processing parameters or AOI.", retryable=False)
        required = ("after_product_id", "after_collection_concept_id", "before_granule_concept_id", "after_granule_concept_id", "frequency", "polarization_term")
        if any(not isinstance(params.get(key), str) or not params[key].strip() for key in required):
            raise ProcessingError("The NISAR job has incomplete acquisition metadata.", retryable=False)
        before_product_id = job.get("item_id")
        before_collection = job.get("collection_id")
        if not isinstance(before_product_id, str) or not isinstance(before_collection, str):
            raise ProcessingError("The NISAR job is missing its before acquisition metadata.", retryable=False)

        with tempfile.TemporaryDirectory(prefix=f"nisar-{job_id}-", dir=PROCESSING_DIRECTORY) as directory:
            root = Path(directory)
            output = process_gcov_change_pair(
                before_product_id=before_product_id,
                after_product_id=params["after_product_id"],
                before_collection_concept_id=before_collection,
                after_collection_concept_id=params["after_collection_concept_id"],
                before_granule_concept_id=params["before_granule_concept_id"],
                after_granule_concept_id=params["after_granule_concept_id"],
                bounds=self._aoi_bounds(aoi),
                frequency=params["frequency"],
                polarization_term=params["polarization_term"],
                output_path=root / "nisar-gcov-change.tif",
                before_directory=root / "before",
                after_directory=root / "after",
                progress=lambda stage: self._progress(job_id, {
                    "retrieving_before": "retrieving",
                    "retrieving_after": "retrieving",
                    "validating": "validating",
                    "publishing": "publishing",
                    "completed": "completed",
                }[stage]),
            )
            if self._cancelled(job_id):
                self._mark_cancelled(job_id)
                return
            raster_path = f"{user_id}/{job_id}/nisar-gcov-change.tif"
            self.admin.upload(raster_path, output.raster_path, "image/tiff")
            if self._cancelled(job_id):
                self._mark_cancelled(job_id)
                return
            now = datetime.now(timezone.utc).isoformat()
            provenance = {
                **output.provenance,
                "output_locations": {"change_cog": raster_path},
                "processing_timestamp": now,
            }
            self.admin.update_job(job_id, {
                "status": "completed", "stage": "completed", "progress": 100,
                "result": {
                    "measurement": output.summary["measurement"],
                    "unit": output.summary["unit"],
                    "summary": output.summary,
                    "bounds": self._aoi_bounds(aoi),
                    "raster_path": raster_path,
                    "evidence_class": "derived_measurement",
                    "interpretation": "This is measured gamma0 backscatter change, not a flood or water classification. Independent validation has not been performed.",
                },
                "provenance": provenance, "error_message": None,
                "lease_expires_at": None, "completed_at": now, "updated_at": now,
            })

    def process_job(
        self,
        job: dict[str, Any],
    ) -> None:
        job_id = str(job["id"])
        user_id = str(job["user_id"]) if job.get("user_id") else "guest"

        if job.get("workflow_id") == "nisar-gcov-change":
            try:
                if self._cancelled(job_id):
                    self._mark_cancelled(job_id)
                    return
                self._progress(job_id, "discovering")
                self._process_nisar_job(job, job_id, user_id)
            except ProcessingCancelled:
                self._mark_cancelled(job_id)
            except NISARProcessingError as error:
                self._handle_failure(job, ProcessingError(str(error), retryable=False))
            except ProcessingError as error:
                self._handle_failure(job, error)
            except Exception:
                LOGGER.exception("Unexpected error while processing NISAR job %s.", job_id)
                self._handle_failure(job, ProcessingError("NISAR processing failed unexpectedly. Check worker logs and retry if appropriate.", retryable=True))
            return

        item_id = job.get("item_id")
        aoi = job.get("aoi_geojson")

        if (
            job.get("workflow_id") != "sentinel2-ndvi"
            or job.get("collection_id") != "sentinel-2-l2a"
            or not isinstance(item_id, str)
            or not isinstance(aoi, dict)
        ):
            self.admin.update_job(
                job_id,
                {
                    "status": "failed",
                    "stage": "failed",
                    "progress": 100,
                    "error_message": (
                        "The queued job has unsupported "
                        "workflow parameters."
                    ),
                    "completed_at": (
                        datetime.now(timezone.utc).isoformat()
                    ),
                    "lease_expires_at": None,
                },
            )

            return

        try:
            if self._cancelled(job_id):
                self._mark_cancelled(job_id)
                return

            self._progress(
                job_id,
                "discovering",
            )

            with tempfile.TemporaryDirectory(
                prefix=f"science-{job_id}-",
                dir=PROCESSING_DIRECTORY,
            ) as directory:

                output = process_sentinel2_ndvi(
                    item_id,
                    aoi,
                    Path(directory),
                    progress=lambda stage: self._progress(
                        job_id,
                        stage,
                    ),
                    cancelled=lambda: self._cancelled(
                        job_id
                    ),
                )

                if self._cancelled(job_id):
                    self._mark_cancelled(job_id)
                    return

                raster_path = (
                    f"{user_id}/{job_id}/sentinel2-ndvi.tif"
                )

                preview_path = (
                    f"{user_id}/{job_id}/sentinel2-ndvi-preview.png"
                )

                self.admin.upload(
                    raster_path,
                    output.raster_path,
                    "image/tiff",
                )

                if self._cancelled(job_id):
                    self._mark_cancelled(job_id)
                    return

                self.admin.upload(
                    preview_path,
                    output.preview_path,
                    "image/png",
                )

                if self._cancelled(job_id):
                    self._mark_cancelled(job_id)
                    return

                now = datetime.now(
                    timezone.utc
                ).isoformat()

                provenance = {
                    **output.provenance,
                    "output_locations": {
                        "geotiff": raster_path,
                        "map_preview": preview_path,
                    },
                    "processing_timestamp": now,
                }

                result = {
                    "measurement": output.summary[
                        "measurement"
                    ],
                    "unit": output.summary["unit"],
                    "summary": output.summary,
                    "bounds": list(output.bounds),
                    "preview_path": preview_path,
                    "raster_path": raster_path,
                    "legend": [
                        {
                            "min": -1.0,
                            "max": 0.0,
                            "label": "Low or negative NDVI",
                        },
                        {
                            "min": 0.0,
                            "max": 0.2,
                            "label": (
                                "Sparse vegetation / mixed surface"
                            ),
                        },
                        {
                            "min": 0.2,
                            "max": 0.4,
                            "label": "Moderate NDVI",
                        },
                        {
                            "min": 0.4,
                            "max": 0.6,
                            "label": "Higher NDVI",
                        },
                        {
                            "min": 0.6,
                            "max": 1.0,
                            "label": "High NDVI",
                        },
                    ],
                    "interpretation": (
                        "Single-date NDVI measurement summary; "
                        "not a crop-health diagnosis or validated "
                        "environmental finding."
                    ),
                }

                self.admin.update_job(
                    job_id,
                    {
                        "status": "completed",
                        "stage": "completed",
                        "progress": 100,
                        "result": result,
                        "provenance": provenance,
                        "error_message": None,
                        "lease_expires_at": None,
                        "completed_at": now,
                        "updated_at": now,
                    },
                )

                LOGGER.info(
                    "Scientific job %s completed successfully.",
                    job_id,
                )

        except ProcessingCancelled:
            self._mark_cancelled(job_id)

        except ProcessingError as error:
            LOGGER.warning(
                "Scientific job %s failed during processing: %s",
                job_id,
                error,
            )

            self._handle_failure(
                job,
                error,
            )

        except Exception as error:
            LOGGER.exception(
                "Unexpected error while processing scientific job %s.",
                job_id,
            )

            self._handle_failure(
                job,
                ProcessingError(
                    (
                        "An unexpected worker error interrupted "
                        "processing. Retry the job or contact "
                        "support with its job ID."
                    ),
                    retryable=True,
                ),
            )

    def _mark_cancelled(
        self,
        job_id: str,
    ) -> None:
        now = datetime.now(
            timezone.utc
        ).isoformat()

        self.admin.update_job(
            job_id,
            {
                "status": "cancelled",
                "stage": "cancelled",
                "progress": 100,
                "lease_expires_at": None,
                "completed_at": now,
                "updated_at": now,
            },
        )

        LOGGER.info(
            "Scientific job %s was cancelled.",
            job_id,
        )

    def _handle_failure(
        self,
        job: dict[str, Any],
        error: ProcessingError,
    ) -> None:
        job_id = str(job["id"])
        attempts = int(job.get("attempts", 1))

        if self._cancelled(job_id):
            self._mark_cancelled(job_id)
            return

        now = datetime.now(timezone.utc)

        retry = (
            error.retryable
            and attempts < MAX_ATTEMPTS
        )

        values: dict[str, Any] = {
            "status": "queued" if retry else "failed",
            "stage": "queued" if retry else "failed",
            "error_message": str(error)[:500],
            "lease_expires_at": None,
            "updated_at": now.isoformat(),
        }

        if retry:
            values["available_at"] = (
                now
                + timedelta(seconds=10 * attempts)
            ).isoformat()

            values["progress"] = 0

            LOGGER.warning(
                "Scientific job %s will be retried. Attempt %s of %s.",
                job_id,
                attempts + 1,
                MAX_ATTEMPTS,
            )

        else:
            values["progress"] = 100
            values["completed_at"] = now.isoformat()

            LOGGER.error(
                "Scientific job %s permanently failed.",
                job_id,
            )

        self.admin.update_job(
            job_id,
            values,
        )


worker: ScienceWorker | None = None
worker_thread: threading.Thread | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global worker, worker_thread

    settings = WorkerSettings()

    if settings.configured:
        worker = ScienceWorker(settings)

        worker_thread = threading.Thread(
            target=worker.run,
            name="science-worker",
            daemon=True,
        )

        worker_thread.start()

        LOGGER.info(
            "Science worker started."
        )

    else:
        LOGGER.error(
            "Science worker credentials are not configured."
        )

    try:
        yield

    finally:
        if worker:
            worker.stop()

        if worker_thread:
            await asyncio.to_thread(
                worker_thread.join,
                5,
            )

        if worker:
            worker.admin.close()

        LOGGER.info(
            "Science worker shutdown complete."
        )


app = FastAPI(
    title="Third Eye Scientific Processing Worker",
    lifespan=lifespan,
)


@app.get("/health")
def health() -> dict[str, Any]:
    configured = WorkerSettings().configured

    running = (
        worker_thread is not None
        and worker_thread.is_alive()
    )

    if not configured:
        raise HTTPException(
            status_code=503,
            detail=(
                "Supabase worker credentials "
                "are not configured."
            ),
        )

    if not running:
        raise HTTPException(
            status_code=503,
            detail="Scientific worker is not running.",
        )

    return {
        "ok": True,
        "worker_running": True,
        "workflows": ["sentinel2-ndvi", "nisar-gcov-change"],
        "earthdata_configured": bool(
            os.environ.get("EARTHDATA_TOKEN", "").strip()
            or (
                os.environ.get("EARTHDATA_USERNAME", "").strip()
                and os.environ.get("EARTHDATA_PASSWORD", "")
            )
        ),
    }


def main() -> None:
    import uvicorn

    uvicorn.run(
        "science_worker.worker:app",
        host=os.environ.get(
            "SCIENCE_WORKER_HOST",
            "0.0.0.0",
        ),
        port=int(
            os.environ.get(
                "PORT",
                "8000",
            )
        ),
        log_level=os.environ.get(
            "LOG_LEVEL",
            "info",
        ),
    )


if __name__ == "__main__":
    main()
