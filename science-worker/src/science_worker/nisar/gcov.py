from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import h5py
import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import Affine
from rasterio.shutil import copy as copy_raster


DIAGONAL_TERMS = ("HHHH", "HVHV", "VVVV", "VHVH", "RHRH", "RVRV")
GCOV_ROOT = "/science/LSAR/GCOV/grids"


class GcovError(ValueError):
    """Raised when a GCOV input is unsupported or scientifically incomplete."""


@dataclass(frozen=True)
class GcovScene:
    source_id: str
    frequency: str
    polarization_term: str
    power: np.ndarray
    backscatter_db: np.ndarray
    valid_mask: np.ndarray
    transform: Affine
    crs: CRS
    metadata: dict[str, Any]


@dataclass(frozen=True)
class GcovChange:
    delta_db: np.ndarray
    valid_mask: np.ndarray
    summary: dict[str, float | int]


def _scalar(dataset: h5py.Dataset) -> float:
    value = np.asarray(dataset[()]).item()
    result = float(value)
    if not np.isfinite(result):
        raise GcovError(f"GCOV metadata {dataset.name} is not finite.")
    return result


def _text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace").strip()
    return str(value).strip()


def _grid_metadata(grid: h5py.Group) -> tuple[np.ndarray, np.ndarray, Affine, CRS]:
    required = ("xCoordinates", "yCoordinates", "projection", "xCoordinateSpacing", "yCoordinateSpacing")
    missing = [name for name in required if name not in grid]
    if missing:
        raise GcovError(f"GCOV grid is missing georeferencing metadata: {', '.join(missing)}.")

    x = np.asarray(grid["xCoordinates"][:], dtype=np.float64)
    y = np.asarray(grid["yCoordinates"][:], dtype=np.float64)
    if x.ndim != 1 or y.ndim != 1 or x.size < 2 or y.size < 2:
        raise GcovError("GCOV coordinate vectors must be one-dimensional and contain at least two pixel centres.")

    dx = _scalar(grid["xCoordinateSpacing"])
    dy = _scalar(grid["yCoordinateSpacing"])
    if dx <= 0 or dy >= 0:
        raise GcovError("GCOV grid spacing must be positive eastward and negative north-up.")
    if not np.allclose(np.diff(x), dx, rtol=0, atol=max(1e-5, abs(dx) * 1e-6)):
        raise GcovError("GCOV x-coordinate vector is not uniformly spaced.")
    if not np.allclose(np.diff(y), dy, rtol=0, atol=max(1e-5, abs(dy) * 1e-6)):
        raise GcovError("GCOV y-coordinate vector is not uniformly spaced.")

    projection = grid["projection"]
    epsg = projection.attrs.get("epsg_code")
    if epsg is None:
        raise GcovError("GCOV projection metadata does not include an EPSG code.")
    try:
        crs = CRS.from_epsg(int(epsg))
    except (TypeError, ValueError) as error:
        raise GcovError("GCOV projection metadata contains an invalid EPSG code.") from error

    transform = Affine(dx, 0.0, float(x[0]) - dx / 2, 0.0, dy, float(y[0]) - dy / 2)
    return x, y, transform, crs


def _window_for_projected_bounds(
    x: np.ndarray,
    y: np.ndarray,
    bounds: tuple[float, float, float, float] | None,
) -> tuple[slice, slice]:
    if bounds is None:
        return slice(0, y.size), slice(0, x.size)

    west, south, east, north = bounds
    if not all(np.isfinite(value) for value in bounds) or west >= east or south >= north:
        raise GcovError("Projected AOI bounds are invalid.")

    columns = np.flatnonzero((x >= west) & (x <= east))
    rows = np.flatnonzero((y >= south) & (y <= north))
    if not columns.size or not rows.size:
        raise GcovError("The selected AOI does not overlap this GCOV grid.")

    return slice(int(rows[0]), int(rows[-1]) + 1), slice(int(columns[0]), int(columns[-1]) + 1)


def read_gcov_scene(
    path: str | Path,
    *,
    frequency: str = "frequencyA",
    polarization_term: str = "HHHH",
    projected_bounds: tuple[float, float, float, float] | None = None,
) -> GcovScene:
    """Read one diagonal GCOV power layer and its quality masks.

    GCOV diagonal covariance layers are already RTC gamma-zero power. This
    function only converts positive power to dB; it does not apply RTC again.
    """
    if frequency not in {"frequencyA", "frequencyB"}:
        raise GcovError("Frequency must be frequencyA or frequencyB.")
    if polarization_term not in DIAGONAL_TERMS:
        raise GcovError(f"Unsupported diagonal covariance term: {polarization_term}.")

    source = Path(path)
    if not source.is_file():
        raise GcovError("The GCOV HDF5 file does not exist.")

    grid_path = f"{GCOV_ROOT}/{frequency}"
    try:
        with h5py.File(source, "r") as product:
            if grid_path not in product:
                raise GcovError(f"The GCOV product does not contain {frequency}.")
            grid = product[grid_path]
            if polarization_term not in grid:
                available = [name for name in DIAGONAL_TERMS if name in grid]
                raise GcovError(
                    f"{polarization_term} is unavailable in {frequency}; available diagonal terms: "
                    f"{', '.join(available) if available else 'none'}."
                )

            x, y, transform, crs = _grid_metadata(grid)
            rows, columns = _window_for_projected_bounds(x, y, projected_bounds)
            power = np.asarray(grid[polarization_term][rows, columns], dtype=np.float32)

            if power.ndim != 2 or power.size == 0:
                raise GcovError("GCOV covariance layer is empty or not two-dimensional.")

            valid = np.isfinite(power) & (power > 0)
            if "mask" in grid:
                mask = np.asarray(grid["mask"][rows, columns])
                valid &= (mask > 0) & (mask < 255)
            if "numberOfLooks" in grid:
                looks = np.asarray(grid["numberOfLooks"][rows, columns], dtype=np.float32)
                valid &= np.isfinite(looks) & (looks > 0)

            db = np.full(power.shape, np.nan, dtype=np.float32)
            np.log10(power, out=db, where=valid)
            db[valid] *= 10.0

            if not valid.any():
                raise GcovError("No valid positive GCOV power pixels remain in the selected area.")

            window_transform = transform * Affine.translation(columns.start or 0, rows.start or 0)
            projection_attrs = grid["projection"].attrs
            metadata = {
                "source_file": source.name,
                "frequency": frequency,
                "polarization_term": polarization_term,
                "epsg": int(crs.to_epsg() or 0),
                "pixel_spacing_x_m": _scalar(grid["xCoordinateSpacing"]),
                "pixel_spacing_y_m": _scalar(grid["yCoordinateSpacing"]),
                "full_grid_shape": [int(y.size), int(x.size)],
                "window_shape": [int(power.shape[0]), int(power.shape[1])],
                "has_mask": "mask" in grid,
                "has_number_of_looks": "numberOfLooks" in grid,
                "rtc_applied_by_source_product": True,
                "radiometry": "gamma0_power",
                "projection_name": _text(projection_attrs.get("grid_mapping_name", "unknown")),
            }

    except OSError as error:
        raise GcovError("The GCOV HDF5 file could not be opened or is incomplete.") from error

    return GcovScene(
        source_id=source.name,
        frequency=frequency,
        polarization_term=polarization_term,
        power=power,
        backscatter_db=db,
        valid_mask=valid,
        transform=window_transform,
        crs=crs,
        metadata=metadata,
    )


def compare_gcov_scenes(before: GcovScene, after: GcovScene) -> GcovChange:
    """Calculate after-minus-before backscatter change on an identical grid."""
    if before.frequency != after.frequency or before.polarization_term != after.polarization_term:
        raise GcovError("GCOV scenes must use the same frequency and diagonal polarization term.")
    if before.crs != after.crs or before.transform != after.transform or before.power.shape != after.power.shape:
        raise GcovError("GCOV scenes are not aligned on an identical projected pixel grid.")

    valid = before.valid_mask & after.valid_mask & np.isfinite(before.backscatter_db) & np.isfinite(after.backscatter_db)
    if not valid.any():
        raise GcovError("The GCOV scenes have no overlapping valid pixels.")

    delta = np.full(before.power.shape, np.nan, dtype=np.float32)
    delta[valid] = after.backscatter_db[valid] - before.backscatter_db[valid]
    values = delta[valid]
    summary: dict[str, float | int] = {
        "valid_pixels": int(values.size),
        "mean_delta_db": float(np.mean(values)),
        "median_delta_db": float(np.median(values)),
        "p10_delta_db": float(np.percentile(values, 10)),
        "p90_delta_db": float(np.percentile(values, 90)),
        "min_delta_db": float(np.min(values)),
        "max_delta_db": float(np.max(values)),
    }
    return GcovChange(delta_db=delta, valid_mask=valid, summary=summary)


def write_gcov_change_cog(
    change: GcovChange,
    *,
    transform: Affine,
    crs: CRS,
    output_path: str | Path,
    provenance: dict[str, str],
) -> Path:
    """Write the computed dB difference as a tiled Cloud Optimized GeoTIFF."""
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".source.tif")
    values = np.where(change.valid_mask, change.delta_db, -9999.0).astype(np.float32)
    profile = {
        "driver": "GTiff",
        "height": int(values.shape[0]),
        "width": int(values.shape[1]),
        "count": 1,
        "dtype": "float32",
        "crs": crs,
        "transform": transform,
        "nodata": -9999.0,
        "compress": "deflate",
        "predictor": 3,
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
    }
    with rasterio.open(temporary, "w", **profile) as dataset:
        dataset.write(values, 1)
        dataset.update_tags(
            1,
            measurement="after_minus_before_gamma0_backscatter",
            units="dB",
            **provenance,
        )
    copy_raster(temporary, destination, driver="COG", compress="DEFLATE", overview_resampling="AVERAGE")
    temporary.unlink(missing_ok=True)
    return destination
