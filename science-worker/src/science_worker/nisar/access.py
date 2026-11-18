from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from harmony import BBox, Client, Collection, Request


class NISARAccessError(RuntimeError):
    """Raised when an authenticated NISAR subset cannot be requested."""


def _client_from_environment() -> Client:
    token = os.getenv("EARTHDATA_TOKEN", "").strip()
    if token:
        return Client(token=token)
    username = os.getenv("EARTHDATA_USERNAME", "").strip()
    password = os.getenv("EARTHDATA_PASSWORD", "")
    if username and password:
        return Client(auth=(username, password))
    raise NISARAccessError(
        "NISAR raster access is not configured. Set EARTHDATA_TOKEN or both "
        "EARTHDATA_USERNAME and EARTHDATA_PASSWORD on the worker."
    )


def request_gcov_subset(
    *,
    collection_concept_id: str,
    granule_concept_id: str,
    bounds: tuple[float, float, float, float],
    frequency: str,
    polarization_term: str,
    output_directory: str | Path,
    client: Any | None = None,
) -> list[Path]:
    """Ask NASA Harmony for AOI-bounded GCOV variables as GeoTIFF/COG outputs.

    This deliberately uses Harmony HTTPS processing instead of direct S3: NISAR
    direct S3 access is restricted to AWS us-west-2, while the current worker is
    not deployed in that region.
    """
    if not collection_concept_id.startswith("C") or not granule_concept_id.startswith("G"):
        raise NISARAccessError("A real NASA CMR collection concept ID and granule concept ID are required.")
    if frequency not in {"frequencyA", "frequencyB"}:
        raise NISARAccessError("Frequency must be frequencyA or frequencyB.")
    if polarization_term not in {"HHHH", "HVHV", "VVVV", "VHVH", "RHRH", "RVRV"}:
        raise NISARAccessError("Only real diagonal GCOV covariance terms can be extracted.")
    west, south, east, north = bounds
    if not all(-180 <= value <= 180 for value in (west, east)) or not (-90 <= south < north <= 90) or west >= east:
        raise NISARAccessError("The geographic bounding box is invalid or crosses the antimeridian.")
    if east - west > 2.0 or north - south > 2.0:
        raise NISARAccessError("The NISAR subset exceeds the current 2-degree per-axis processing limit.")

    harmony_client = client or _client_from_environment()
    variable_root = f"/science/LSAR/GCOV/grids/{frequency}"
    variables = [
        f"{variable_root}/{polarization_term}",
        f"{variable_root}/mask",
        f"{variable_root}/numberOfLooks",
    ]
    request = Request(
        collection=Collection(id=collection_concept_id),
        spatial=BBox(west, south, east, north),
        granule_id=[granule_concept_id],
        variables=variables,
        format="image/tiff",
        max_results=1,
    )

    destination = Path(output_directory)
    destination.mkdir(parents=True, exist_ok=True)
    try:
        job_id = harmony_client.submit(request)
        harmony_client.wait_for_processing(job_id, show_progress=False)
        futures = harmony_client.download_all(job_id, directory=str(destination), overwrite=True)
        outputs = [Path(future.result()) for future in futures]
    except Exception as error:
        raise NISARAccessError("NASA Harmony could not retrieve the requested GCOV subset.") from error

    if not outputs:
        raise NISARAccessError("NASA Harmony completed without returning any GCOV subset files.")
    for output in outputs:
        if not output.is_file() or output.stat().st_size == 0:
            raise NISARAccessError("NASA Harmony returned a missing or empty GCOV output.")
    return outputs
