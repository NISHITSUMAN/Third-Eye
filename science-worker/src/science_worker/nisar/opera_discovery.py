from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx


CMR_GRANULES = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"
OPERA_DSWX_S1_COLLECTION = "C2949811996-POCLOUD"
ALLOWED_DOWNLOAD_HOSTS = {"archive.podaac.earthdata.nasa.gov"}
MAX_REFERENCE_BYTES = 2_000_000_000


class OPERAReferenceError(RuntimeError):
    """Raised when an OPERA reference cannot be safely discovered or retrieved."""


@dataclass(frozen=True)
class OPERAReference:
    path: Path
    granule_concept_id: str
    granule_ur: str
    acquired_at: str
    download_url: str
    collection_concept_id: str = OPERA_DSWX_S1_COLLECTION
    product: str = "OPERA_L3_DSWX-S1_V1 WTR"


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise OPERAReferenceError("Acquisition timestamps must include a UTC offset.")
    return parsed.astimezone(timezone.utc)


def _granule_time(umm: dict) -> datetime | None:
    temporal = umm.get("TemporalExtent", {})
    extent = temporal.get("RangeDateTime", {}) if isinstance(temporal, dict) else {}
    value = extent.get("BeginningDateTime") if isinstance(extent, dict) else None
    if not isinstance(value, str):
        return None
    try:
        return _parse_time(value)
    except (ValueError, OPERAReferenceError):
        return None


def _wtr_url(umm: dict) -> str | None:
    related = umm.get("RelatedUrls", [])
    if not isinstance(related, list):
        return None
    candidates: list[str] = []
    for item in related:
        if not isinstance(item, dict):
            continue
        url = item.get("URL")
        if not isinstance(url, str) or not url.lower().split("?")[0].endswith((".tif", ".tiff")):
            continue
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in ALLOWED_DOWNLOAD_HOSTS:
            continue
        filename = Path(parsed.path).name.upper()
        if re.search(r"(?:^|[_-])WTR(?:[_\.-]|$)", filename):
            candidates.append(url)
    return sorted(set(candidates))[0] if candidates else None


def discover_and_download_opera_dswx_s1(
    *,
    bounds_wgs84: tuple[float, float, float, float],
    target_acquired_at: str,
    output_directory: str | Path,
    maximum_temporal_separation_hours: float = 72.0,
    client: httpx.Client | None = None,
) -> OPERAReference | None:
    """Find the closest time-matched OPERA DSWx-S1 WTR granule intersecting an AOI.

    Returns None when CMR has no matching WTR granule. The download requires an
    Earthdata bearer token in EARTHDATA_TOKEN because PO.DAAC's science-data
    bucket is protected. This routine never substitutes a browse image or
    silently treats an unavailable reference as a successful validation.
    """
    west, south, east, north = bounds_wgs84
    if not all(map(lambda x: isinstance(x, (int, float)) and abs(x) <= 180, bounds_wgs84)):
        raise OPERAReferenceError("AOI bounds must be finite WGS84 coordinates.")
    if west >= east or south >= north or south < -90 or north > 90:
        raise OPERAReferenceError("AOI bounds are invalid.")
    maximum_gap = float(maximum_temporal_separation_hours)
    if not 0 < maximum_gap <= 168:
        raise OPERAReferenceError("Temporal separation must be greater than 0 and no more than 168 hours.")

    target = _parse_time(target_acquired_at)
    start = (target - timedelta(hours=maximum_gap)).isoformat().replace("+00:00", "Z")
    end = (target + timedelta(hours=maximum_gap)).isoformat().replace("+00:00", "Z")
    own_client = client is None
    session = client or httpx.Client(timeout=httpx.Timeout(60.0, connect=15.0), follow_redirects=True)
    try:
        response = session.get(
            CMR_GRANULES,
            params={
                "collection_concept_id": OPERA_DSWX_S1_COLLECTION,
                "bounding_box": f"{west},{south},{east},{north}",
                "temporal": f"{start},{end}",
                "page_size": "100",
                "sort_key": "-start_date",
                "downloadable": "true",
            },
            headers={"Accept": "application/vnd.nasa.cmr.umm_results+json"},
        )
        response.raise_for_status()
        payload = response.json()
        items = payload.get("items", []) if isinstance(payload, dict) else []
        eligible: list[tuple[float, dict, datetime, str]] = []
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            meta = item.get("meta", {})
            umm = item.get("umm", {})
            if not isinstance(meta, dict) or not isinstance(umm, dict):
                continue
            acquired = _granule_time(umm)
            url = _wtr_url(umm)
            concept = meta.get("concept-id")
            if acquired is None or not url or not isinstance(concept, str):
                continue
            gap = abs((target - acquired).total_seconds()) / 3600
            if gap <= maximum_gap:
                eligible.append((gap, item, acquired, url))
        if not eligible:
            return None

        _, selected, acquired, url = min(eligible, key=lambda row: row[0])
        token = os.environ.get("EARTHDATA_TOKEN", "").strip()
        if not token:
            raise OPERAReferenceError(
                "A time-matched OPERA granule was found, but download requires EARTHDATA_TOKEN "
                "on the science worker. No reference validation was performed."
            )
        output = Path(output_directory)
        output.mkdir(parents=True, exist_ok=True)
        filename = Path(urlparse(url).path).name
        if not filename or not re.search(r"(?:^|[_-])WTR(?:[_\.-]|$)", filename.upper()):
            raise OPERAReferenceError("CMR returned an unexpected OPERA reference filename.")
        destination = output / filename
        total = 0
        with session.stream("GET", url, headers={"Authorization": f"Bearer {token}"}) as download:
            download.raise_for_status()
            with destination.open("wb") as sink:
                for chunk in download.iter_bytes(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_REFERENCE_BYTES:
                        sink.close()
                        destination.unlink(missing_ok=True)
                        raise OPERAReferenceError("OPERA reference exceeds the 2 GB safety limit.")
                    sink.write(chunk)
        if total == 0:
            destination.unlink(missing_ok=True)
            raise OPERAReferenceError("PO.DAAC returned an empty OPERA reference file.")
        meta = selected.get("meta", {})
        umm = selected.get("umm", {})
        return OPERAReference(
            path=destination,
            granule_concept_id=str(meta["concept-id"]),
            granule_ur=str(umm.get("GranuleUR", "")),
            acquired_at=acquired.isoformat(),
            download_url=url,
        )
    except httpx.HTTPError as error:
        raise OPERAReferenceError(f"NASA CMR/PO.DAAC reference request failed: {error}") from error
    finally:
        if own_client:
            session.close()
