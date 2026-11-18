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
from PIL import Image


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
    number_of_looks: np.ndarray | None = None


@dataclass(frozen=True)
class GcovChange:
    delta_db: np.ndarray
    valid_mask: np.ndarray
    summary: dict[str, float | int]
    standard_error_db: np.ndarray | None = None


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
            looks: np.ndarray | None = None
            if "mask" in grid:
                # GCOV mask values describe the adaptive multi-looking
                # ensemble. They are not a Boolean validity flag.
                mask = np.asarray(grid["mask"][rows, columns])
                if mask.shape != power.shape:
                    raise GcovError("The GCOV mask layer is not aligned with its covariance term.")
            if "numberOfLooks" in grid:
                looks = np.asarray(grid["numberOfLooks"][rows, columns], dtype=np.float32)
                if looks.shape != power.shape:
                    raise GcovError("The GCOV numberOfLooks layer is not aligned with its covariance term.")
                valid &= np.isfinite(looks) & (looks > 0)

            db = np.full(power.shape, np.nan, dtype=np.float32)
            np.log10(power, out=db, where=valid)
            db[valid] *= 10.0

            if not valid.any():
                raise GcovError("No valid positive GCOV power pixels remain in the selected area.")

            window_transform = transform @ Affine.translation(columns.start or 0, rows.start or 0)
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
        number_of_looks=looks,
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
    standard_error_db: np.ndarray | None = None
    if before.number_of_looks is not None and after.number_of_looks is not None:
        if before.number_of_looks.shape != delta.shape or after.number_of_looks.shape != delta.shape:
            raise GcovError("GCOV numberOfLooks arrays must match the compared power grids.")
        valid &= np.isfinite(before.number_of_looks) & (before.number_of_looks > 0)
        valid &= np.isfinite(after.number_of_looks) & (after.number_of_looks > 0)
        standard_error_db = np.full(delta.shape, np.nan, dtype=np.float32)
        factor = 10.0 / np.log(10.0)
        standard_error_db[valid] = factor * np.sqrt(1.0 / before.number_of_looks[valid] + 1.0 / after.number_of_looks[valid])
        delta[~valid] = np.nan
    if not valid.any():
        raise GcovError("The GCOV scenes have no pixels with valid power and number-of-looks metadata.")
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
    return GcovChange(delta_db=delta, valid_mask=valid, summary=summary, standard_error_db=standard_error_db)


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



def write_negative_backscatter_screening_mask(
    change: GcovChange,
    *,
    transform: Affine,
    crs: CRS,
    output_path: str | Path,
    threshold_db: float = -3.0,
) -> Path:
    """Write a binary negative-change screening layer, never a water class.

    1 means only that after-minus-before gamma0 backscatter is at or below
    the explicitly recorded threshold. It is not a water/flood prediction.
    """
    threshold = float(threshold_db)
    if not np.isfinite(threshold) or threshold >= 0:
        raise GcovError("The screening threshold must be a finite negative dB value.")
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    values = np.full(change.delta_db.shape, 255, dtype=np.uint8)
    valid = change.valid_mask & np.isfinite(change.delta_db)
    values[valid] = (change.delta_db[valid] <= threshold).astype(np.uint8)
    temporary = destination.with_suffix(".source.tif")
    profile = {
        "driver": "GTiff",
        "height": int(values.shape[0]),
        "width": int(values.shape[1]),
        "count": 1,
        "dtype": "uint8",
        "crs": crs,
        "transform": transform,
        "nodata": 255,
        "compress": "deflate",
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
    }
    with rasterio.open(temporary, "w", **profile) as dataset:
        dataset.write(values, 1)
        dataset.update_tags(
            1,
            measurement="negative_backscatter_change_screening",
            threshold_db=threshold,
            class_1="negative backscatter change screening candidate; not water",
            class_0="valid pixel not at or below the selected negative-change threshold",
            nodata_255="invalid or outside the submitted AOI",
            classification="not a water, flood, fire, landslide, or hazard classification",
        )
    copy_raster(temporary, destination, driver="COG", compress="DEFLATE", overview_resampling="NEAREST")
    temporary.unlink(missing_ok=True)
    return destination


def write_gcov_change_preview(
    change: GcovChange,
    *,
    output_path: str | Path,
    maximum_dimension: int = 1600,
) -> tuple[Path, tuple[float, float]]:
    """Render a transparent, display-only diverging PNG from a change raster.

    The range is robustly clipped at the 98th percentile of absolute change.
    The image is a visual aid, not a georeferenced raster or a classification.
    """
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    valid_values = np.asarray(change.delta_db[change.valid_mask], dtype=np.float32)
    if valid_values.size == 0 or not np.isfinite(valid_values).all():
        raise GcovError("A preview requires finite, valid change pixels.")
    limit = max(float(np.percentile(np.abs(valid_values), 98)), 0.1)
    scaled = np.clip(change.delta_db / limit, -1.0, 1.0)
    rgba = np.zeros((*scaled.shape, 4), dtype=np.uint8)
    valid = change.valid_mask & np.isfinite(scaled)
    negative = np.clip(-scaled, 0.0, 1.0)[..., None]
    positive = np.clip(scaled, 0.0, 1.0)[..., None]
    neutral = np.array([242.0, 245.0, 248.0], dtype=np.float32)
    blue = np.array([35.0, 119.0, 214.0], dtype=np.float32)
    red = np.array([220.0, 67.0, 61.0], dtype=np.float32)
    rgb = np.where(scaled[..., None] < 0, neutral * (1.0 - negative) + blue * negative,
                   neutral * (1.0 - positive) + red * positive)
    rgba[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    rgba[..., 3] = np.where(valid, 255, 0).astype(np.uint8)
    image = Image.fromarray(rgba, mode="RGBA")
    if max(image.size) > maximum_dimension:
        scale = maximum_dimension / max(image.size)
        size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
        image = image.resize(size, Image.Resampling.NEAREST)
    image.save(destination, format="PNG", optimize=True)
    return destination, (-limit, limit)


def read_gcov_cog_scene(
    power_path: str | Path,
    *,
    frequency: str,
    polarization_term: str,
    mask_path: str | Path | None = None,
    number_of_looks_path: str | Path | None = None,
    source_id: str | None = None,
) -> GcovScene:
    """Read a GCOV variable extracted by NASA Harmony as a georeferenced COG.

    Harmony's NISAR service extracts the HDF5 variable into an individual
    Cloud-Optimized GeoTIFF. The source layer remains RTC gamma-zero power.
    The GCOV mask is retained as provenance only: it describes the averaging
    ensemble and is not a binary validity mask. Raster nodata/masks and
    positive finite power are used for pixel validity.
    """
    if frequency not in {"frequencyA", "frequencyB"}:
        raise GcovError("Frequency must be frequencyA or frequencyB.")
    if polarization_term not in DIAGONAL_TERMS:
        raise GcovError(f"Unsupported diagonal covariance term: {polarization_term}.")

    source = Path(power_path)
    if not source.is_file():
        raise GcovError("The Harmony GCOV COG does not exist.")

    try:
        with rasterio.open(source) as dataset:
            if dataset.count != 1 or dataset.crs is None:
                raise GcovError("The Harmony GCOV COG must have one band and a valid CRS.")
            if dataset.width < 1 or dataset.height < 1:
                raise GcovError("The Harmony GCOV COG is empty.")
            power = dataset.read(1).astype(np.float32, copy=False)
            valid = (dataset.read_masks(1) > 0) & np.isfinite(power) & (power > 0)
            transform = dataset.transform
            crs = dataset.crs
            profile = {
                "width": dataset.width,
                "height": dataset.height,
                "transform": transform,
                "crs": crs,
                "nodata": dataset.nodata,
                "tags": dataset.tags(),
            }

        looks_available = False
        looks: np.ndarray | None = None
        if number_of_looks_path is not None:
            with rasterio.open(number_of_looks_path) as looks_ds:
                if (
                    looks_ds.count != 1
                    or looks_ds.crs != crs
                    or looks_ds.transform != transform
                    or looks_ds.width != profile["width"]
                    or looks_ds.height != profile["height"]
                ):
                    raise GcovError("The GCOV numberOfLooks COG is not aligned with its power layer.")
                looks = looks_ds.read(1).astype(np.float32, copy=False)
                valid &= (looks_ds.read_masks(1) > 0) & np.isfinite(looks) & (looks > 0)
                looks_available = True

        mask_available = False
        if mask_path is not None:
            with rasterio.open(mask_path) as mask_ds:
                if (
                    mask_ds.count != 1
                    or mask_ds.crs != crs
                    or mask_ds.transform != transform
                    or mask_ds.width != profile["width"]
                    or mask_ds.height != profile["height"]
                ):
                    raise GcovError("The GCOV mask COG is not aligned with its power layer.")
                # The mask encodes the source averaging ensemble, not a
                # Boolean valid/invalid flag. Do not guess bit semantics.
                mask_available = True

    except rasterio.errors.RasterioIOError as error:
        raise GcovError("A Harmony GCOV COG could not be opened or is incomplete.") from error

    if not valid.any():
        raise GcovError("No valid positive GCOV power pixels remain in the selected area.")

    db = np.full(power.shape, np.nan, dtype=np.float32)
    np.log10(power, out=db, where=valid)
    db[valid] *= 10.0

    metadata = {
        "source_file": source.name,
        "frequency": frequency,
        "polarization_term": polarization_term,
        "epsg": int(crs.to_epsg() or 0),
        "pixel_spacing_x_m": float(abs(transform.a)),
        "pixel_spacing_y_m": float(abs(transform.e)),
        "window_shape": [int(power.shape[0]), int(power.shape[1])],
        "has_mask": mask_available,
        "has_number_of_looks": looks_available,
        "rtc_applied_by_source_product": True,
        "radiometry": "gamma0_power",
        "source_service": "NASA Harmony NISAR variable subsetting",
        "source_tags": profile["tags"],
    }
    return GcovScene(
        source_id=source_id or source.name,
        frequency=frequency,
        polarization_term=polarization_term,
        power=power,
        backscatter_db=db,
        valid_mask=valid,
        transform=transform,
        crs=crs,
        metadata=metadata,
        number_of_looks=looks,
    )

