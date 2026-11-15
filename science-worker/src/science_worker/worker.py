from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import FastAPI, HTTPException

from .processor import ProcessingCancelled, ProcessingError, process_sentinel2_ndvi

LOGGER = logging.getLogger("third_eye.science_worker")
BUCKET = "scientific-results"
MAX_ATTEMPTS = 3
POLL_SECONDS = 3.0
JOB_LEASE_MINUTES = 15
PROCESSING_DIRECTORY = Path(os.environ.get("SCIENCE_PROCESSING_DIRECTORY", tempfile.gettempdir()))


class WorkerSettings:
    def __init__(self) -> None:
        self.supabase_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
        self.service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        self.poll_seconds = max(1.0, float(os.environ.get("SCIENCE_WORKER_POLL_SECONDS", POLL_SECONDS)))

    @property
    def configured(self) -> bool:
        return bool(self.supabase_url and self.service_role_key)


class SupabaseAdmin:
    def __init__(self, settings: WorkerSettings) -> None:
        self.base_url = settings.supabase_url
        self.client = httpx.Client(
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={
                "apikey": settings.service_role_key,
                "Authorization": f"Bearer {settings.service_role_key}",
                "Accept": "application/json",
            },
        )

    def rpc(self, name: str, body: dict[str, Any] | None = None) -> Any:
        response = self.client.post(f"{self.base_url}/rest/v1/rpc/{name}", json=body or {})
        if not response.is_success:
            raise RuntimeError(f"Supabase RPC {name} returned HTTP {response.status_code}.")
        return response.json()

    def get_job(self, job_id: str) -> dict[str, Any]:
        response = self.client.get(
            f"{self.base_url}/rest/v1/scientific_jobs",
            params={"id": f"eq.{job_id}", "select": "id,user_id,status,attempts,cancel_requested_at"},
        )
        if not response.is_success:
            raise RuntimeError(f"Supabase job read returned HTTP {response.status_code}.")
        rows = response.json()
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
            raise RuntimeError("The claimed scientific job could not be read.")
        return rows[0]

    def update_job(self, job_id: str, values: dict[str, Any]) -> None:
        response = self.client.patch(
            f"{self.base_url}/rest/v1/scientific_jobs",
            params={"id": f"eq.{job_id}"},
            json=values,
            headers={"Prefer": "return=minimal"},
        )
        if not response.is_success:
            raise RuntimeError(f"Supabase job update returned HTTP {response.status_code}.")

    def upload(self, path: str, file_path: Path, content_type: str) -> None:
        encoded_path = quote(path, safe="/")
        with file_path.open("rb") as source:
            response = self.client.post(
                f"{self.base_url}/storage/v1/object/{BUCKET}/{encoded_path}",
                content=source,
                headers={
                    "Content-Type": content_type,
                    "x-upsert": "true",
                },
            )
        if not response.is_success:
            raise RuntimeError(f"Supabase Storage upload returned HTTP {response.status_code}.")


class ScienceWorker:
    def __init__(self, settings: WorkerSettings) -> None:
        self.settings = settings
        self.admin = SupabaseAdmin(settings)
        self.stop_event = threading.Event()

    def run(self) -> None:
        LOGGER.info("Scientific worker polling enabled.")
        while not self.stop_event.is_set():
            try:
                claimed = self.admin.rpc("claim_next_scientific_job")
                job = claimed[0] if isinstance(claimed, list) and claimed else claimed
                if isinstance(job, dict) and job.get("id"):
                    self.process_job(job)
                    continue
            except Exception as error:
                LOGGER.error("Worker poll failed (%s).", type(error).__name__)
            self.stop_event.wait(self.settings.poll_seconds)

    def stop(self) -> None:
        self.stop_event.set()

    def _cancelled(self, job_id: str) -> bool:
        return self.admin.get_job(job_id).get("cancel_requested_at") is not None

    def _progress(self, job_id: str, stage: str) -> None:
        values = {
            "stage": stage,
            "progress": {
                "discovering": 10,
                "retrieving": 25,
                "validating": 45,
                "processing": 65,
                "publishing": 85,
                "completed": 100,
            }[stage],
            "lease_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=JOB_LEASE_MINUTES)).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self.admin.update_job(job_id, values)

    def process_job(self, job: dict[str, Any]) -> None:
        job_id = str(job["id"])
        user_id = str(job["user_id"])
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
                    "error_message": "The queued job has unsupported workflow parameters.",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "lease_expires_at": None,
                },
            )
            return

        try:
            if self._cancelled(job_id):
                self._mark_cancelled(job_id)
                return
            self._progress(job_id, "discovering")
            with tempfile.TemporaryDirectory(prefix=f"science-{job_id}-", dir=PROCESSING_DIRECTORY) as directory:
                output = process_sentinel2_ndvi(
                    item_id,
                    aoi,
                    Path(directory),
                    progress=lambda stage: self._progress(job_id, stage),
                    cancelled=lambda: self._cancelled(job_id),
                )
                if self._cancelled(job_id):
                    self._mark_cancelled(job_id)
                    return

                raster_path = f"{user_id}/{job_id}/sentinel2-ndvi.tif"
                preview_path = f"{user_id}/{job_id}/sentinel2-ndvi-preview.png"
                self.admin.upload(raster_path, output.raster_path, "image/tiff")
                if self._cancelled(job_id):
                    self._mark_cancelled(job_id)
                    return
                self.admin.upload(preview_path, output.preview_path, "image/png")
                if self._cancelled(job_id):
                    self._mark_cancelled(job_id)
                    return

                now = datetime.now(timezone.utc).isoformat()
                provenance = {
                    **output.provenance,
                    "output_locations": {
                        "geotiff": raster_path,
                        "map_preview": preview_path,
                    },
                    "processing_timestamp": now,
                }
                result = {
                    "measurement": output.summary["measurement"],
                    "unit": output.summary["unit"],
                    "summary": output.summary,
                    "bounds": list(output.bounds),
                    "preview_path": preview_path,
                    "raster_path": raster_path,
                    "legend": [
                        {"min": -1.0, "max": 0.0, "label": "Low or negative NDVI"},
                        {"min": 0.0, "max": 0.2, "label": "Sparse vegetation / mixed surface"},
                        {"min": 0.2, "max": 0.4, "label": "Moderate NDVI"},
                        {"min": 0.4, "max": 0.6, "label": "Higher NDVI"},
                        {"min": 0.6, "max": 1.0, "label": "High NDVI"},
                    ],
                    "interpretation": "Single-date NDVI measurement summary; not a crop-health diagnosis or validated environmental finding.",
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
        except ProcessingCancelled:
            self._mark_cancelled(job_id)
        except ProcessingError as error:
            self._handle_failure(job, error)
        except Exception as error:
            LOGGER.error("Scientific job %s failed (%s).", job_id, type(error).__name__)
            self._handle_failure(
                job,
                ProcessingError(
                    "An unexpected worker error interrupted processing. Retry the job or contact support with its job ID.",
                    retryable=True,
                ),
            )

    def _mark_cancelled(self, job_id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
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

    def _handle_failure(self, job: dict[str, Any], error: ProcessingError) -> None:
        job_id = str(job["id"])
        attempts = int(job.get("attempts", 1))
        if self._cancelled(job_id):
            self._mark_cancelled(job_id)
            return
        now = datetime.now(timezone.utc)
        retry = error.retryable and attempts < MAX_ATTEMPTS
        values: dict[str, Any] = {
            "status": "queued" if retry else "failed",
            "stage": "queued" if retry else "failed",
            "error_message": str(error)[:500],
            "lease_expires_at": None,
            "updated_at": now.isoformat(),
        }
        if retry:
            values["available_at"] = (now + timedelta(seconds=10 * attempts)).isoformat()
            values["progress"] = 0
        else:
            values["progress"] = 100
            values["completed_at"] = now.isoformat()
        self.admin.update_job(job_id, values)


worker: ScienceWorker | None = None
worker_thread: threading.Thread | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global worker, worker_thread
    settings = WorkerSettings()
    if settings.configured:
        worker = ScienceWorker(settings)
        worker_thread = threading.Thread(target=worker.run, name="science-worker", daemon=True)
        worker_thread.start()
    try:
        yield
    finally:
        if worker:
            worker.stop()
        if worker_thread:
            await asyncio.to_thread(worker_thread.join, 5)


app = FastAPI(title="Third Eye Scientific Processing Worker", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    configured = WorkerSettings().configured
    if not configured:
        raise HTTPException(status_code=503, detail="Supabase worker credentials are not configured.")
    return {
        "ok": True,
        "worker_running": worker_thread is not None and worker_thread.is_alive(),
        "workflow": "sentinel2-ndvi",
    }


def main() -> None:
    import uvicorn

    uvicorn.run(
        "science_worker.worker:app",
        host=os.environ.get("SCIENCE_WORKER_HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8000")),
        log_level=os.environ.get("LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()
