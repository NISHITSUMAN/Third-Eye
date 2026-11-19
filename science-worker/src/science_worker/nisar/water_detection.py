from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy import ndimage


class WaterScreeningError(ValueError):
    """Raised when inputs cannot support a defensible water-change screen."""


@dataclass(frozen=True)
class WaterScreeningResult:
    candidate_mask: np.ndarray
    excluded_historical_water: int
    excluded_steep_terrain: int
    removed_small_components: int
    candidate_pixels: int
    candidate_area_km2: float
    component_count: int
    metadata: dict[str, Any]


def screen_candidate_new_open_water(
    delta_db: np.ndarray,
    valid_mask: np.ndarray,
    *,
    threshold_db: float,
    threshold_rationale: str,
    pixel_area_m2: float,
    historical_water_mask: np.ndarray | None = None,
    slope_degrees: np.ndarray | None = None,
    maximum_slope_degrees: float | None = None,
    maximum_slope_rationale: str | None = None,
    minimum_mapping_unit_m2: float = 0.0,
    opening_iterations: int = 0,
) -> WaterScreeningResult:
    """Create an explicitly provisional candidate-new-open-water screen.

    This is not a flood classifier. The caller must supply a documented,
    documented threshold rationale and must not describe the output as confirmed
    water or flooding. Permanent-water exclusion and terrain filtering are
    applied only when their aligned input rasters are supplied.
    """
    delta = np.asarray(delta_db, dtype=np.float64)
    valid = np.asarray(valid_mask, dtype=bool)
    if delta.ndim != 2 or valid.shape != delta.shape:
        raise WaterScreeningError("Change raster and validity mask must be aligned two-dimensional arrays.")
    if not np.isfinite(delta[valid]).all() or not valid.any():
        raise WaterScreeningError("Valid change pixels must contain finite values and at least one pixel.")
    threshold = float(threshold_db)
    if not np.isfinite(threshold) or threshold >= 0:
        raise WaterScreeningError("The negative backscatter threshold must be finite and below 0 dB.")
    if not threshold_rationale.strip():
        raise WaterScreeningError("A documented, scene-specific threshold rationale is required.")
    if not np.isfinite(pixel_area_m2) or pixel_area_m2 <= 0:
        raise WaterScreeningError("Pixel area must be a finite positive value.")
    if not np.isfinite(minimum_mapping_unit_m2) or minimum_mapping_unit_m2 < 0:
        raise WaterScreeningError("Minimum mapping unit must be finite and non-negative.")
    if opening_iterations < 0 or opening_iterations > 5:
        raise WaterScreeningError("Opening iterations must be between 0 and 5.")

    candidate = valid & (delta <= threshold)
    historical_excluded = 0
    if historical_water_mask is not None:
        historical = np.asarray(historical_water_mask, dtype=bool)
        if historical.shape != delta.shape:
            raise WaterScreeningError("Historical-water mask must match the change raster grid.")
        historical_excluded = int(np.count_nonzero(candidate & historical))
        candidate &= ~historical

    steep_excluded = 0
    if slope_degrees is not None:
        slope = np.asarray(slope_degrees, dtype=np.float64)
        if slope.shape != delta.shape:
            raise WaterScreeningError("Slope raster must match the change raster grid.")
        if maximum_slope_degrees is None or not np.isfinite(maximum_slope_degrees):
            raise WaterScreeningError("A finite maximum slope is required when a slope raster is supplied.")
        if not isinstance(maximum_slope_rationale, str) or not maximum_slope_rationale.strip():
            raise WaterScreeningError("A documented slope-threshold rationale is required when a slope raster is supplied.")
        terrain_valid = np.isfinite(slope) & (slope >= 0)
        steep = ~terrain_valid | (slope > float(maximum_slope_degrees))
        steep_excluded = int(np.count_nonzero(candidate & steep))
        candidate &= ~steep

    if opening_iterations:
        candidate = ndimage.binary_opening(
            candidate,
            structure=np.ones((3, 3), dtype=bool),
            iterations=opening_iterations,
            border_value=0,
        )

    labels, component_count = ndimage.label(candidate, structure=np.ones((3, 3), dtype=np.uint8))
    if minimum_mapping_unit_m2 > 0 and component_count:
        counts = np.bincount(labels.ravel())
        minimum_pixels = int(np.ceil(minimum_mapping_unit_m2 / pixel_area_m2))
        keep = counts >= minimum_pixels
        keep[0] = False
        filtered = keep[labels]
        removed_small = int(np.count_nonzero(candidate & ~filtered))
        candidate = filtered
        labels, component_count = ndimage.label(candidate, structure=np.ones((3, 3), dtype=np.uint8))
    else:
        removed_small = 0

    pixels = int(candidate.sum())
    return WaterScreeningResult(
        candidate_mask=candidate.astype(bool),
        excluded_historical_water=historical_excluded,
        excluded_steep_terrain=steep_excluded,
        removed_small_components=removed_small,
        candidate_pixels=pixels,
        candidate_area_km2=round(pixels * pixel_area_m2 / 1_000_000, 6),
        component_count=int(component_count),
        metadata={
            "evidence_class": "provisional_candidate_screen",
            "label": "candidate new open water",
            "not_a_flood_classification": True,
            "threshold_db": threshold,
            "threshold_rationale": threshold_rationale.strip(),
            "threshold_calibrated": False,
            "historical_water_exclusion_applied": historical_water_mask is not None,
            "slope_filter_applied": slope_degrees is not None,
            "maximum_slope_degrees": maximum_slope_degrees,
            "maximum_slope_rationale": maximum_slope_rationale.strip() if maximum_slope_rationale else None,
            "minimum_mapping_unit_m2": float(minimum_mapping_unit_m2),
            "opening_iterations": opening_iterations,
            "connectivity": 8,
            "component_count": int(component_count),
            "limitations": [
                "Negative radar backscatter change is not uniquely attributable to open water.",
                "This screen is not a validated flood or inundation classification.",
                "Threshold calibration and independent, time-matched validation are required before accuracy claims.",
                "Vegetated and urban flooding may not produce a negative backscatter response.",
            ],
        },
    )
