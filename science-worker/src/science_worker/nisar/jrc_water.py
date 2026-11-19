from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.vrt import WarpedVRT


JRC_GSW_VERSION = "1.5"
JRC_GSW_PERIOD = "1984-2024"
JRC_GSW_ATTRIBUTION = "Source: EC JRC/Google"
JRC_GSW_BASE_URL = (
    "https://s3.waw4-1.cloudferro.com/swift/v1/global-surface-water/"
    "download2024/Aggregated/VER1-5/occurrence"
)
MAX_TILE_BYTES = 32 * 1024 * 1024
MAX_TILES_PER_AOI = 9


class JRCWaterContextError(RuntimeError):
    """Raised when a trustworthy JRC occurrence context cannot be retrieved."""


@dataclass(frozen=True)
class JRCWaterContext:
    occurrence_percent: np.ndarray
    valid_mask: np.ndarray
    provenance: dict[str, Any]


def _longitude_label(value: int) -> str:
    return f"{abs(value)}{'E' if value >= 0 else 'W'}"


def _latitude_label(value: int) -> str:
    return f"{abs(value)}{'N' if value >= 0 else 'S'}"


def jrc_occurrence_tile_urls(
    bounds_wgs84: tuple[float, float, float, float],
) -> list[str]:
    """Return the official JRC GSW v1.5 occurrence tile URLs intersecting bounds.

    Tiles are 10° x 10° and are named by their north-west corner. An east or
    south bound exactly on a tile edge does not request the adjacent tile.
    """
    west, south, east, north = (float(value) for value in bounds_wgs84)
    if not all(np.isfinite(value) for value in (west, south, east, north)):
        raise JRCWaterContextError("AOI bounds must be finite WGS84 coordinates.")
    if west < -180 or east > 180 or south < -90 or north > 90 or west >= east or south >= north:
        raise JRCWaterContextError("AOI bounds are invalid WGS84 coordinates.")
    if east - west > 2.000001 or north - south > 2.000001:
        raise JRCWaterContextError("JRC context retrieval is limited to a 2-degree AOI on each axis.")

    epsilon = 1e-9
    west_edge = int(np.floor(west / 10.0) * 10)
    east_edge = int(np.floor((east - epsilon) / 10.0) * 10)
    north_edge = int(np.ceil((north - epsilon) / 10.0) * 10)
    south_edge = int(np.ceil((south + epsilon) / 10.0) * 10)
    longitudes = range(west_edge, east_edge + 1, 10)
    latitudes = range(north_edge, south_edge - 1, -10)

    urls: list[str] = []
    for latitude in latitudes:
        for longitude in longitudes:
            tile_name = (
                f"occurrence_{_longitude_label(longitude)}_{_latitude_label(latitude)}"
                f"_v1_5_2024.tif"
            )
            urls.append(f"{JRC_GSW_BASE_URL}/{tile_name}")
    if not urls or len(urls) > MAX_TILES_PER_AOI:
        raise JRCWaterContextError("The AOI intersects an unsupported number of JRC occurrence tiles.")
    return urls


def _download_tile(url: str, destination: Path, client: httpx.Client) -> Path:
    if destination.is_file() and 8 <= destination.stat().st_size <= MAX_TILE_BYTES:
        return destination
    try:
        response = client.get(url, timeout=60.0)
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise JRCWaterContextError(f"JRC occurrence tile could not be downloaded: {url.rsplit('/', 1)[-1]}") from error

    content = response.content
    if len(content) < 8 or len(content) > MAX_TILE_BYTES:
        raise JRCWaterContextError("A JRC occurrence tile exceeded the permitted download size.")
    if content[:4] not in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"):
        raise JRCWaterContextError("The JRC occurrence endpoint did not return a GeoTIFF.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    temporary.write_bytes(content)
    temporary.replace(destination)
    return destination


def load_jrc_occurrence_aligned(
    *,
    bounds_wgs84: tuple[float, float, float, float],
    target_crs: CRS,
    target_transform: Affine,
    target_shape: tuple[int, int],
    cache_directory: str | Path,
    client: httpx.Client | None = None,
) -> JRCWaterContext:
    """Download only intersecting v1.5 tiles and align occurrence to a target grid.

    JRC value 255 is nodata; 0-100 are occurrence percentages. Nearest-neighbour
    reprojection preserves the categorical validity semantics and avoids
    inventing intermediate occurrence values.
    """
    height, width = (int(target_shape[0]), int(target_shape[1]))
    if height < 1 or width < 1 or height * width > 4_000_000:
        raise JRCWaterContextError("The target grid must contain between 1 and 4,000,000 pixels.")
    urls = jrc_occurrence_tile_urls(bounds_wgs84)
    cache = Path(cache_directory)
    own_client = client is None
    http = client or httpx.Client(
        timeout=httpx.Timeout(60.0, connect=10.0),
        follow_redirects=True,
        headers={"User-Agent": "ThirdEye/1.0 (JRC GSW v1.5 context retrieval)"},
    )
    occurrence = np.full((height, width), 255, dtype=np.uint8)
    used: list[dict[str, Any]] = []
    try:
        for url in urls:
            name = url.rsplit("/", 1)[-1]
            path = _download_tile(url, cache / name, http)
            try:
                with rasterio.open(path) as source:
                    if source.count != 1 or source.crs is None:
                        raise JRCWaterContextError("A JRC occurrence tile has an invalid raster profile.")
                    if source.dtypes[0] != "uint8":
                        raise JRCWaterContextError("A JRC occurrence tile has an unexpected data type.")
                    with WarpedVRT(
                        source,
                        crs=target_crs,
                        transform=target_transform,
                        width=width,
                        height=height,
                        resampling=Resampling.nearest,
                        src_nodata=255,
                        nodata=255,
                        dtype="uint8",
                    ) as aligned:
                        tile = aligned.read(1)
            except rasterio.errors.RasterioError as error:
                raise JRCWaterContextError("A downloaded JRC occurrence GeoTIFF could not be read.") from error

            covered = (tile != 255) & (occurrence == 255)
            occurrence[covered] = tile[covered]
            used.append({
                "file": name,
                "url": url,
                "source_crs": "EPSG:4326",
                "resampling": "nearest",
                "nodata": 255,
                "valid_value_range": [0, 100],
            })
    finally:
        if own_client:
            http.close()

    valid = (occurrence != 255) & (occurrence <= 100)
    if not valid.any():
        raise JRCWaterContextError("JRC occurrence tiles did not cover the target GCOV grid.")

    values = occurrence.astype(np.float32)
    values[~valid] = np.nan
    return JRCWaterContext(
        occurrence_percent=values,
        valid_mask=valid,
        provenance={
            "source": "European Commission Joint Research Centre Global Surface Water",
            "dataset": "Global Surface Water occurrence",
            "version": JRC_GSW_VERSION,
            "period": JRC_GSW_PERIOD,
            "resolution_m": 30,
            "attribution": JRC_GSW_ATTRIBUTION,
            "license": "Copernicus Programme; see official JRC data-access terms",
            "tiles": used,
            "target_crs": target_crs.to_string(),
            "target_transform": list(target_transform)[:6],
            "target_shape": [height, width],
            "resampling": "nearest",
            "valid_pixels": int(valid.sum()),
            "coverage_percent": round(float(valid.mean() * 100), 2),
            "nodata_value": 255,
            "occurrence_semantics": "0-100 percent of valid observations with water; 255 is nodata",
            "limitations": [
                "Long-term optical Landsat occurrence is historical context, not event-time flood truth.",
                "A high occurrence threshold is an operational screening choice, not a permanent-water class supplied by this loader.",
                "The 2022-2024 Collection 2 extension has documented residual co-registration differences relative to earlier Collection 1 data.",
            ],
        },
    )
