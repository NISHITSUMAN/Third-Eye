from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.vrt import WarpedVRT


COPERNICUS_DEM_BUCKET = "copernicus-dem-30m"
COPERNICUS_DEM_VERSION = "GLO-30 Public / 2021 release"
MAX_DEM_TILES_PER_AOI = 9


class CopernicusDEMError(RuntimeError):
    """Raised when a usable Copernicus GLO-30 slope context cannot be built."""


@dataclass(frozen=True)
class CopernicusSlopeContext:
    slope_degrees: np.ndarray
    valid_mask: np.ndarray
    provenance: dict[str, Any]


def _lat_label(value: int) -> str:
    return f"{'N' if value >= 0 else 'S'}{abs(value):02d}"


def _lon_label(value: int) -> str:
    return f"{'E' if value >= 0 else 'W'}{abs(value):03d}"


def copernicus_dem_tile_urls(
    bounds_wgs84: tuple[float, float, float, float],
) -> list[str]:
    """Build public one-degree GLO-30 COG URLs for an AOI."""
    west, south, east, north = (float(value) for value in bounds_wgs84)
    if not all(np.isfinite(value) for value in (west, south, east, north)):
        raise CopernicusDEMError("AOI bounds must be finite WGS84 coordinates.")
    if west < -180 or east > 180 or south < -90 or north > 90 or west >= east or south >= north:
        raise CopernicusDEMError("AOI bounds are invalid WGS84 coordinates.")
    if east - west > 2.000001 or north - south > 2.000001:
        raise CopernicusDEMError("Copernicus DEM retrieval is limited to a 2-degree AOI on each axis.")

    epsilon = 1e-9
    west_tile = int(np.floor(west))
    east_tile = int(np.floor(east - epsilon))
    south_tile = int(np.floor(south))
    north_tile = int(np.floor(north - epsilon))
    urls: list[str] = []
    for latitude in range(south_tile, north_tile + 1):
        for longitude in range(west_tile, east_tile + 1):
            name = (
                f"Copernicus_DSM_COG_10_{_lat_label(latitude)}_00_"
                f"{_lon_label(longitude)}_00_DEM"
            )
            urls.append(
                f"https://{COPERNICUS_DEM_BUCKET}.s3.eu-central-1.amazonaws.com/"
                f"{name}/{name}.tif"
            )
    if not urls or len(urls) > MAX_DEM_TILES_PER_AOI:
        raise CopernicusDEMError("The AOI intersects an unsupported number of Copernicus DEM tiles.")
    return urls


def calculate_slope_degrees(
    elevation_m: np.ndarray,
    valid_mask: np.ndarray,
    *,
    pixel_size_x_m: float,
    pixel_size_y_m: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Calculate a first-order slope surface from aligned elevation in metres."""
    elevation = np.asarray(elevation_m, dtype=np.float64)
    valid_input = np.asarray(valid_mask, dtype=bool)
    if elevation.ndim != 2 or valid_input.shape != elevation.shape:
        raise CopernicusDEMError("Elevation and validity inputs must be aligned two-dimensional arrays.")
    valid = valid_input & np.isfinite(elevation)
    if not np.isfinite(pixel_size_x_m) or not np.isfinite(pixel_size_y_m) or pixel_size_x_m <= 0 or pixel_size_y_m <= 0:
        raise CopernicusDEMError("Projected pixel sizes must be finite positive metres.")
    slope = np.full(elevation.shape, np.nan, dtype=np.float32)
    if elevation.shape[0] < 2 or elevation.shape[1] < 2 or not valid.any():
        return slope, np.zeros(elevation.shape, dtype=bool)

    safe_elevation = np.where(valid, elevation, np.nan)
    with np.errstate(invalid="ignore", divide="ignore"):
        dz_dy, dz_dx = np.gradient(safe_elevation, pixel_size_y_m, pixel_size_x_m)
        values = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    slope_valid = valid & np.isfinite(values)
    slope[slope_valid] = values[slope_valid].astype(np.float32)
    return slope, slope_valid


def load_copernicus_slope_aligned(
    *,
    bounds_wgs84: tuple[float, float, float, float],
    target_crs: CRS,
    target_transform: Affine,
    target_shape: tuple[int, int],
) -> CopernicusSlopeContext:
    """Read public GLO-30 COG windows and align a DSM-derived slope to the GCOV grid.

    The source is a digital surface model (buildings and vegetation included),
    not a bare-earth terrain model. Remote COG access uses GDAL range requests.
    """
    height, width = (int(target_shape[0]), int(target_shape[1]))
    if height < 1 or width < 1 or height * width > 4_000_000:
        raise CopernicusDEMError("The target grid must contain between 1 and 4,000,000 pixels.")
    if not target_crs.is_projected:
        raise CopernicusDEMError("Slope calculation requires a projected target CRS with metre units.")
    urls = copernicus_dem_tile_urls(bounds_wgs84)
    elevation = np.full((height, width), np.nan, dtype=np.float32)
    used: list[dict[str, Any]] = []
    missing: list[str] = []

    with rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
        GDAL_HTTP_MAX_RETRY="2",
        GDAL_HTTP_RETRY_DELAY="1",
    ):
        for url in urls:
            name = url.rsplit("/", 1)[-1]
            try:
                with rasterio.open("/vsicurl/" + url) as source:
                    if source.count != 1 or source.crs is None:
                        raise CopernicusDEMError("A Copernicus DEM tile has an invalid raster profile.")
                    nodata = source.nodata
                    with WarpedVRT(
                        source,
                        crs=target_crs,
                        transform=target_transform,
                        width=width,
                        height=height,
                        resampling=Resampling.bilinear,
                        src_nodata=nodata,
                        nodata=-9999.0,
                        dtype="float32",
                    ) as aligned:
                        tile = aligned.read(1, masked=True).astype(np.float32).filled(np.nan)
                covered = np.isfinite(tile) & ~np.isfinite(elevation)
                elevation[covered] = tile[covered]
                used.append({
                    "file": name,
                    "url": url,
                    "source": "Copernicus DEM GLO-30 Public",
                    "resampling": "bilinear",
                    "nodata": nodata,
                })
            except (rasterio.errors.RasterioError, OSError):
                missing.append(name)

    elevation_valid = np.isfinite(elevation)
    if not elevation_valid.any():
        raise CopernicusDEMError("No Copernicus GLO-30 DEM tiles were available for the target grid.")

    # Pixel-vector lengths preserve correct slope units for rotated/sheared grids.
    x_resolution = float(np.hypot(target_transform.a, target_transform.d))
    y_resolution = float(np.hypot(target_transform.b, target_transform.e))
    unit_factor = target_crs.linear_units_factor[1] if target_crs.linear_units_factor else 1.0
    slope, slope_valid = calculate_slope_degrees(
        elevation,
        elevation_valid,
        pixel_size_x_m=x_resolution * unit_factor,
        pixel_size_y_m=y_resolution * unit_factor,
    )
    if not slope_valid.any():
        raise CopernicusDEMError("The aligned DEM did not contain enough adjacent valid pixels to calculate slope.")

    return CopernicusSlopeContext(
        slope_degrees=slope,
        valid_mask=slope_valid,
        provenance={
            "source": "Copernicus DEM GLO-30 Public",
            "release": COPERNICUS_DEM_VERSION,
            "product_type": "digital surface model (DSM)",
            "resolution_m": 30,
            "license": "Copernicus DEM terms for GLO-30 Public",
            "tiles": used,
            "missing_tiles": missing,
            "target_crs": target_crs.to_string(),
            "target_transform": list(target_transform)[:6],
            "target_shape": [height, width],
            "elevation_resampling": "bilinear",
            "slope_method": "first-order finite differences on the projected target grid",
            "valid_slope_pixels": int(slope_valid.sum()),
            "coverage_percent": round(float(slope_valid.mean() * 100), 2),
            "limitations": [
                "Copernicus GLO-30 is a DSM and includes buildings and vegetation.",
                "Slope is a terrain-screening proxy, not a hydrological model or flood-susceptibility score.",
                "The 2021 DEM release is static and may not represent current surface modifications.",
            ],
        },
    )
