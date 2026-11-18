from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject

from .validation import BinaryValidationMetrics, ValidationError, evaluate_binary_reference


class ReferenceRasterError(ValidationError):
    """Raised when an independent reference cannot be matched safely."""


@dataclass(frozen=True)
class ReferenceAgreementReport:
    reference_source: str
    reference_product: str
    target_acquired_at: str
    reference_acquired_at: str
    temporal_separation_hours: float
    maximum_temporal_separation_hours: float
    water_class_values: tuple[int, ...]
    land_class_values: tuple[int, ...]
    excluded_class_values: tuple[int, ...]
    evaluated_pixels: int
    candidate_coverage_percent: float
    metrics: BinaryValidationMetrics
    method: str = "nearest-neighbour candidate-mask reprojection to the independent reference grid"


def _timestamp(value: str, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ReferenceRasterError(f"{field} is required for time-aware validation.")
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as error:
        raise ReferenceRasterError(f"{field} must be an ISO-8601 timestamp.") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ReferenceRasterError(f"{field} must include an explicit UTC offset.")
    return parsed


def _class_values(values: Iterable[int], field: str) -> tuple[int, ...]:
    raw = tuple(values)
    if not raw:
        raise ReferenceRasterError(f"At least one explicit {field} code is required.")
    if any(isinstance(value, bool) or not isinstance(value, (int, np.integer)) for value in raw):
        raise ReferenceRasterError(f"{field} codes must be integers.")
    result = tuple(int(value) for value in raw)
    if len(result) != len(set(result)):
        raise ReferenceRasterError(f"{field} codes must be unique.")
    return result


def validate_candidate_mask_against_reference(
    candidate_mask_path: str | Path,
    reference_raster_path: str | Path,
    *,
    reference_source: str,
    reference_product: str,
    target_acquired_at: str,
    reference_acquired_at: str,
    water_class_values: Iterable[int],
    land_class_values: Iterable[int],
    excluded_class_values: Iterable[int] = (),
    maximum_temporal_separation_hours: float = 72.0,
    reference_band: int = 1,
) -> ReferenceAgreementReport:
    """Compare a binary screening mask with an independent classified reference.

    The caller must supply the reference class mapping from the selected
    product's current specification. No class codes are guessed. The reference
    is nearest-neighbour reprojected to the candidate grid; nodata, excluded
    classes, and pixels outside either valid footprint are omitted.

    Metrics describe agreement for this AOI/date pair only. They are not a
    transferable accuracy guarantee, calibrated confidence, or proof that the
    candidate mask is a flood map.
    """
    source_name = str(reference_source).strip()
    product_name = str(reference_product).strip()
    if not source_name or not product_name:
        raise ReferenceRasterError("The independent reference source and product must be named.")

    water_codes = _class_values(water_class_values, "water-class")
    land_codes = _class_values(land_class_values, "land-class")
    excluded_codes = tuple(dict.fromkeys(int(value) for value in excluded_class_values))
    if set(water_codes) & set(land_codes):
        raise ReferenceRasterError("Water and land class codes must not overlap.")
    if set(water_codes) & set(excluded_codes) or set(land_codes) & set(excluded_codes):
        raise ReferenceRasterError("Excluded class codes must not overlap water or land codes.")

    maximum_gap = float(maximum_temporal_separation_hours)
    if not np.isfinite(maximum_gap) or maximum_gap <= 0 or maximum_gap > 168:
        raise ReferenceRasterError("Maximum temporal separation must be greater than 0 and no more than 168 hours.")
    target_time = _timestamp(target_acquired_at, "Target acquisition time")
    reference_time = _timestamp(reference_acquired_at, "Reference acquisition time")
    separation = abs((target_time - reference_time).total_seconds()) / 3600
    if separation > maximum_gap:
        raise ReferenceRasterError(
            f"Reference acquisition is {separation:.1f} hours from the target, "
            f"exceeding the {maximum_gap:.1f}-hour validation window."
        )

    candidate_path = Path(candidate_mask_path)
    reference_path = Path(reference_raster_path)
    if not candidate_path.is_file() or not reference_path.is_file():
        raise ReferenceRasterError("Both candidate and reference raster files must exist.")

    with rasterio.open(candidate_path) as candidate, rasterio.open(reference_path) as reference:
        if candidate.count < 1 or reference.count < reference_band:
            raise ReferenceRasterError("The candidate or reference raster does not contain the requested band.")
        if candidate.crs is None or reference.crs is None:
            raise ReferenceRasterError("Both rasters must declare a coordinate reference system.")
        if candidate.width <= 0 or candidate.height <= 0 or reference.width <= 0 or reference.height <= 0:
            raise ReferenceRasterError("The candidate or reference raster grid is empty.")

        predicted_source = candidate.read(1)
        candidate_valid_source = candidate.dataset_mask() > 0
        if candidate.nodata is not None:
            candidate_valid_source &= predicted_source != candidate.nodata
        candidate_valid_source &= np.isfinite(predicted_source)
        if not candidate_valid_source.any():
            raise ReferenceRasterError("The candidate mask contains no valid pixels.")
        if not np.all(np.isin(predicted_source[candidate_valid_source], [0, 1])):
            raise ReferenceRasterError("Candidate mask pixels must be binary: 1=candidate, 0=not candidate.")

        raw_reference = reference.read(reference_band)
        reference_valid = reference.dataset_mask() > 0
        if reference.nodata is not None:
            reference_valid &= raw_reference != reference.nodata
        if np.issubdtype(raw_reference.dtype, np.floating):
            reference_valid &= np.isfinite(raw_reference)
        known_codes = set(water_codes) | set(land_codes)
        reference_valid &= np.isin(raw_reference, tuple(known_codes))
        if excluded_codes:
            reference_valid &= ~np.isin(raw_reference, excluded_codes)

        # Evaluate on the independent reference grid. This avoids expanding a
        # coarser 30 m reference into many apparently independent finer pixels.
        aligned_prediction = np.full((reference.height, reference.width), 255, dtype=np.uint8)
        aligned_candidate_valid = np.zeros((reference.height, reference.width), dtype=np.uint8)
        reproject(
            source=predicted_source.astype(np.uint8, copy=False),
            destination=aligned_prediction,
            src_transform=candidate.transform,
            src_crs=candidate.crs,
            src_nodata=candidate.nodata,
            dst_transform=reference.transform,
            dst_crs=reference.crs,
            dst_nodata=255,
            resampling=Resampling.nearest,
        )
        reproject(
            source=candidate_valid_source.astype(np.uint8),
            destination=aligned_candidate_valid,
            src_transform=candidate.transform,
            src_crs=candidate.crs,
            src_nodata=0,
            dst_transform=reference.transform,
            dst_crs=reference.crs,
            dst_nodata=0,
            resampling=Resampling.nearest,
        )

    valid = reference_valid & (aligned_candidate_valid == 1) & np.isin(aligned_prediction, [0, 1])
    if not valid.any():
        raise ReferenceRasterError("The candidate and independent reference have no common valid pixels.")

    prediction = aligned_prediction
    observed = np.isin(raw_reference, water_codes).astype(np.uint8)
    metrics = evaluate_binary_reference(prediction, observed, valid_mask=valid)

    return ReferenceAgreementReport(
        reference_source=source_name,
        reference_product=product_name,
        target_acquired_at=target_time.isoformat(),
        reference_acquired_at=reference_time.isoformat(),
        temporal_separation_hours=round(separation, 3),
        maximum_temporal_separation_hours=maximum_gap,
        water_class_values=water_codes,
        land_class_values=land_codes,
        excluded_class_values=excluded_codes,
        evaluated_pixels=metrics.evaluated_pixels,
        candidate_coverage_percent=round(metrics.evaluated_pixels / int(reference_valid.sum()) * 100, 2),
        metrics=metrics,
    )


def reference_agreement_to_dict(report: ReferenceAgreementReport) -> dict[str, object]:
    """Serialize a validation report without losing its source/time metadata."""
    result = asdict(report)
    result["metrics"] = asdict(report.metrics)
    result["interpretation"] = (
        "Exploratory agreement with the named independent reference for this AOI and date pair only. "
        "Not a calibrated confidence score or a guarantee of performance elsewhere."
    )
    return result


def validate_against_opera_dswx_s1_wtr(
    candidate_mask_path: str | Path,
    opera_wtr_raster_path: str | Path,
    *,
    target_acquired_at: str,
    reference_acquired_at: str,
    maximum_temporal_separation_hours: float = 72.0,
) -> ReferenceAgreementReport:
    """Validate the screening mask against the OPERA DSWx-S1 WTR layer.

    Class codes follow the NASA/JPL OPERA DSWx-S1 Product Specification v1.0.0:
    0=not water, 1=open water, 3=inundated vegetation, 250=HAND masked,
    251=layover/shadow masked, and 255=fill. Only 0/1/3 are evaluated.
    The caller remains responsible for selecting the correct WTR granule,
    confirming its spatial overlap, and reviewing the source metadata.
    """
    return validate_candidate_mask_against_reference(
        candidate_mask_path,
        opera_wtr_raster_path,
        reference_source="NASA/JPL OPERA",
        reference_product="OPERA_L3_DSWX-S1_V1 WTR",
        target_acquired_at=target_acquired_at,
        reference_acquired_at=reference_acquired_at,
        water_class_values=(1, 3),
        land_class_values=(0,),
        excluded_class_values=(250, 251, 255),
        maximum_temporal_separation_hours=maximum_temporal_separation_hours,
    )
