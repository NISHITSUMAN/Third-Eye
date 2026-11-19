from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
from rasterio.features import geometry_mask
from rasterio.warp import transform_geom
import re

from .access import request_gcov_subset
from .gcov import GcovChange, GcovScene, align_gcov_scene_to_grid, compare_gcov_scenes, read_gcov_cog_scene, write_gcov_change_cog, write_gcov_change_preview, write_negative_backscatter_screening_mask, write_gcov_uncertainty_cog, write_candidate_new_open_water_screening_mask
from .validation import negative_backscatter_threshold_sensitivity
from .pairing import PairAssessment, assess_gcov_pair
from .water_detection import WaterScreeningError, screen_candidate_new_open_water
from .jrc_water import JRCWaterContextError, load_jrc_occurrence_aligned
from .copernicus_dem import CopernicusDEMError, load_copernicus_slope_aligned


class NISARProcessingError(RuntimeError):
    """Raised when a real NISAR GCOV pair cannot be processed safely."""


@dataclass(frozen=True)
class NISARChangeOutput:
    raster_path: Path
    summary: dict[str, float | int]
    provenance: dict[str, object]
    compatibility: PairAssessment
    preview_path: Path
    preview_range_db: tuple[float, float]
    screening_mask_path: Path
    screening_threshold_db: float
    uncertainty_path: Path | None
    water_screening_mask_path: Path | None


def _layer_path(paths: list[Path], variable: str, *, required: bool) -> Path | None:
    matches = [
        path for path in paths
        if re.search(rf"(?:^|[_-]){re.escape(variable)}(?:[_\.-]|$)", path.name, re.IGNORECASE)
    ]
    if len(matches) > 1:
        raise NISARProcessingError(f"NASA Harmony returned multiple {variable} layers for one acquisition.")
    if matches:
        return matches[0]
    if required:
        raise NISARProcessingError(
            f"NASA Harmony did not return the requested {variable} raster. "
            "The selected product may not contain this polarization/frequency."
        )
    return None


def _request_scene(
    *,
    collection_concept_id: str,
    granule_concept_id: str,
    bounds: tuple[float, float, float, float],
    frequency: str,
    polarization_term: str,
    output_directory: Path,
    client: object | None,
) -> GcovScene:
    paths = request_gcov_subset(
        collection_concept_id=collection_concept_id,
        granule_concept_id=granule_concept_id,
        bounds=bounds,
        frequency=frequency,
        polarization_term=polarization_term,
        output_directory=output_directory,
        client=client,
    )
    power = _layer_path(paths, polarization_term, required=True)
    mask = _layer_path(paths, "mask", required=False)
    looks = _layer_path(paths, "numberOfLooks", required=False)
    assert power is not None
    return read_gcov_cog_scene(
        power,
        frequency=frequency,
        polarization_term=polarization_term,
        mask_path=mask,
        number_of_looks_path=looks,
        source_id=granule_concept_id,
    )


def process_gcov_change_pair(
    *,
    before_product_id: str,
    after_product_id: str,
    before_collection_concept_id: str,
    after_collection_concept_id: str,
    before_granule_concept_id: str,
    after_granule_concept_id: str,
    bounds: tuple[float, float, float, float],
    frequency: str,
    polarization_term: str,
    output_path: str | Path,
    before_directory: str | Path,
    after_directory: str | Path,
    client_factory: Callable[[], object] | None = None,
    progress: Callable[[str], None] | None = None,
    aoi_geojson: dict[str, object] | None = None,
) -> NISARChangeOutput:
    """Retrieve two AOI-bounded Harmony GCOV subsets and calculate real dB change.

    The two rasters must already share an identical CRS and pixel grid. This
    function deliberately rejects misaligned products instead of silently
    resampling one acquisition and changing the scientific comparison.
    """
    try:
        compatibility = assess_gcov_pair(
            before_product_id,
            after_product_id,
            frequency=frequency,
            polarization_term=polarization_term,
        )
    except ValueError as error:
        raise NISARProcessingError(str(error)) from error
    if not compatibility.compatible:
        raise NISARProcessingError(
            "The selected NISAR acquisitions are not compatible: "
            + " ".join(compatibility.reasons)
        )

    if progress:
        progress("retrieving_before")
    before_client = client_factory() if client_factory else None
    before = _request_scene(
        collection_concept_id=before_collection_concept_id,
        granule_concept_id=before_granule_concept_id,
        bounds=bounds,
        frequency=frequency,
        polarization_term=polarization_term,
        output_directory=Path(before_directory),
        client=before_client,
    )

    if progress:
        progress("retrieving_after")
    after_client = client_factory() if client_factory else None
    after = _request_scene(
        collection_concept_id=after_collection_concept_id,
        granule_concept_id=after_granule_concept_id,
        bounds=bounds,
        frequency=frequency,
        polarization_term=polarization_term,
        output_directory=Path(after_directory),
        client=after_client,
    )

    if progress:
        progress("validating")
    try:
        after = align_gcov_scene_to_grid(after, before)
        change = compare_gcov_scenes(before, after)
    except ValueError as error:
        raise NISARProcessingError(
            "The selected NISAR rasters could not be compared on a common grid: " + str(error)
        ) from error

    aoi_pixel_count: int | None = None
    if aoi_geojson is not None:
        if aoi_geojson.get("type") not in {"Polygon", "MultiPolygon"}:
            raise NISARProcessingError("The NISAR AOI must be a GeoJSON Polygon or MultiPolygon.")
        try:
            projected_geometry = transform_geom("EPSG:4326", before.crs, aoi_geojson, precision=6)
            inside_aoi = geometry_mask(
                [projected_geometry],
                out_shape=change.delta_db.shape,
                transform=before.transform,
                invert=True,
                all_touched=False,
            )
        except Exception as error:
            raise NISARProcessingError("The submitted AOI could not be projected onto the GCOV pixel grid.") from error
        aoi_pixel_count = int(inside_aoi.sum())
        if aoi_pixel_count == 0:
            raise NISARProcessingError("The submitted polygon contains no GCOV pixel centres at this resolution.")
        clipped_valid = change.valid_mask & inside_aoi
        if not clipped_valid.any():
            raise NISARProcessingError("No valid before/after GCOV pixels fall inside the submitted AOI polygon.")
        clipped_delta = np.full(change.delta_db.shape, np.nan, dtype=np.float32)
        clipped_delta[clipped_valid] = change.delta_db[clipped_valid]
        values = clipped_delta[clipped_valid]
        clipped_standard_error = None
        if change.standard_error_db is not None:
            clipped_standard_error = np.full(change.standard_error_db.shape, np.nan, dtype=np.float32)
            clipped_standard_error[clipped_valid] = change.standard_error_db[clipped_valid]
        change = GcovChange(
            delta_db=clipped_delta,
            valid_mask=clipped_valid,
            summary={
                "valid_pixels": int(values.size),
                "mean_delta_db": float(np.mean(values)),
                "median_delta_db": float(np.median(values)),
                "p10_delta_db": float(np.percentile(values, 10)),
                "p90_delta_db": float(np.percentile(values, 90)),
                "min_delta_db": float(np.min(values)),
                "max_delta_db": float(np.max(values)),
            },
            standard_error_db=clipped_standard_error,
        )

    pixel_area_m2 = abs(float(before.transform.a * before.transform.e))
    summary = {
        **change.summary,
        "valid_area_km2": round(change.summary["valid_pixels"] * pixel_area_m2 / 1_000_000, 6),
        "pixel_area_m2": pixel_area_m2,
        "measurement": "after-minus-before gamma0 backscatter change",
        "unit": "dB",
        **({
            "aoi_raster_pixels": aoi_pixel_count,
            "valid_pixel_coverage_percent": round(change.summary["valid_pixels"] / aoi_pixel_count * 100, 2),
            "valid_pixel_coverage_scope": "AOI pixel centres within the returned raster extent only; does not measure polygon area outside the returned dataset.",
        } if aoi_pixel_count is not None else {}),
    }
    uncertainty: dict[str, object] = {
        "available": False,
        "method": "not_available",
        "interpretation": "No uncertainty diagnostic is reported because aligned positive numberOfLooks rasters were not available for both acquisitions.",
    }
    if change.standard_error_db is not None:
        standard_errors = change.standard_error_db[change.valid_mask]
        if standard_errors.size and np.isfinite(standard_errors).all():
            half_width = 1.96 * standard_errors
            standardized_change = np.abs(change.delta_db[change.valid_mask]) / standard_errors
            uncertainty = {
                "available": True,
                "method": "first-order delta-method approximation for log-transformed independent gamma power estimates using per-pixel numberOfLooks",
                "assumptions": [
                    "Before and after power estimates are treated as independent.",
                    "numberOfLooks is treated as effective looks for each power estimate.",
                    "Log-power variance uses a first-order delta-method approximation.",
                ],
                "median_standard_error_db": round(float(np.median(standard_errors)), 4),
                "median_approximate_95_percent_half_width_db": round(float(np.median(half_width)), 4),
                "p90_approximate_95_percent_half_width_db": round(float(np.percentile(half_width, 90)), 4),
                "fraction_absolute_change_larger_than_approximate_95_percent_half_width": round(float(np.mean(standardized_change > 1.96)), 4),
                "warning": "Approximate per-pixel measurement-noise diagnostic only; not calibrated confidence, a formal scene-level interval, a multiple-testing-adjusted significance test, or a hazard probability.",
            }
    if uncertainty.get("available") is True:
        summary.update({
            "median_standard_error_db": float(uncertainty["median_standard_error_db"]),
            "median_approximate_95_percent_half_width_db": float(uncertainty["median_approximate_95_percent_half_width_db"]),
            "p90_approximate_95_percent_half_width_db": float(uncertainty["p90_approximate_95_percent_half_width_db"]),
            "fraction_change_larger_than_approximate_95_percent_half_width": float(uncertainty["fraction_absolute_change_larger_than_approximate_95_percent_half_width"]),
        })
    sensitivity = negative_backscatter_threshold_sensitivity(change.delta_db, change.valid_mask, [-1.0, -3.0, -6.0])
    preview_path, preview_range_db, preview_bounds_wgs84 = write_gcov_change_preview(
        change,
        output_path=Path(output_path).with_name("nisar-gcov-change-preview.png"),
        transform=before.transform,
        crs=before.crs,
    )
    screening_threshold_db = -3.0
    uncertainty_path: Path | None = None
    if change.standard_error_db is not None:
        uncertainty_path = write_gcov_uncertainty_cog(
            change,
            transform=before.transform,
            crs=before.crs,
            output_path=Path(output_path).with_name("nisar-gcov-uncertainty.tif"),
        )
    screening_mask_path = write_negative_backscatter_screening_mask(
        change,
        transform=before.transform,
        crs=before.crs,
        output_path=Path(output_path).with_name("nisar-negative-change-screening.tif"),
        threshold_db=screening_threshold_db,
    )

    # JRC GSW v1.5 and Copernicus GLO-30 are contextual screening layers,
    # not event-time ground truth. Either context source may be unavailable
    # without preventing the primary NISAR measurement from completing.
    water_screening_mask_path: Path | None = None
    jrc_context = None
    dem_context = None
    jrc_error: str | None = None
    dem_error: str | None = None
    try:
        jrc_context = load_jrc_occurrence_aligned(
            bounds_wgs84=bounds,
            target_crs=before.crs,
            target_transform=before.transform,
            target_shape=change.delta_db.shape,
        )
    except (JRCWaterContextError, ValueError, OSError) as error:
        jrc_error = str(error)
    try:
        dem_context = load_copernicus_slope_aligned(
            bounds_wgs84=bounds,
            target_crs=before.crs,
            target_transform=before.transform,
            target_shape=change.delta_db.shape,
        )
    except (CopernicusDEMError, ValueError, OSError) as error:
        dem_error = str(error)

    water_screening_metadata: dict[str, object] = {
        "available": False,
        "status": "unavailable",
        "classification": False,
        "historical_water_context": jrc_context.provenance if jrc_context is not None else {
            "available": False,
            "reason": jrc_error or "JRC context was not retrieved.",
        },
        "terrain_context": dem_context.provenance if dem_context is not None else {
            "available": False,
            "reason": dem_error or "Copernicus DEM slope context was not retrieved.",
        },
    }
    if jrc_context is not None:
        high_occurrence_reference = (
            jrc_context.valid_mask
            & (jrc_context.occurrence_percent >= 90.0)
        )
        slope_degrees = dem_context.slope_degrees if dem_context is not None else None
        maximum_slope_degrees = 10.0 if dem_context is not None else None
        water_screen = screen_candidate_new_open_water(
            change.delta_db,
            change.valid_mask,
            threshold_db=screening_threshold_db,
            threshold_rationale=(
                "Fixed -3 dB exploratory negative-backscatter screening setting. "
                "It is not calibrated to this scene, is not a water classifier, "
                "and must not be interpreted as flood extent."
            ),
            pixel_area_m2=pixel_area_m2,
            historical_water_mask=high_occurrence_reference,
            slope_degrees=slope_degrees,
            maximum_slope_degrees=maximum_slope_degrees,
            maximum_slope_rationale=(
                "10 degree operational terrain-screening threshold used only to suppress "
                "steep-slope candidates. It is not a hydrological or flood-susceptibility "
                "cutoff and has not been calibrated for this AOI."
) if slope_degrees is not None else None,
            minimum_mapping_unit_m2=900.0,
        )
        water_screening_mask_path = write_candidate_new_open_water_screening_mask(
            change,
            water_screen.candidate_mask,
            transform=before.transform,
            crs=before.crs,
            output_path=Path(output_path).with_name("nisar-candidate-new-water-screening.tif"),
            occurrence_exclusion_percent=90.0,
        )
        water_screening_metadata = {
            "available": True,
            "status": "provisional_screening",
            "label": "candidate new open water screening",
            "classification": False,
            "calibrated": False,
            "candidate_pixels": water_screen.candidate_pixels,
            "candidate_area_km2": water_screen.candidate_area_km2,
            "excluded_high_occurrence_reference_pixels": water_screen.excluded_historical_water,
            "excluded_steep_terrain_pixels": water_screen.excluded_steep_terrain,
            "removed_small_component_pixels": water_screen.removed_small_components,
            "component_count": water_screen.component_count,
            "screening_parameters": water_screen.metadata,
            "historical_water_context": {
                **jrc_context.provenance,
                "exclusion_rule": "JRC occurrence >=90%; high long-term occurrence reference, not an event-time permanent-water truth mask",
            },
            "terrain_context": dem_context.provenance if dem_context is not None else {
                "available": False,
                "reason": dem_error or "No aligned Copernicus GLO-30 slope raster was available.",
            },
            "limitations": [
                "The fixed -3 dB radar threshold is not scene-calibrated.",
                "JRC occurrence is historical optical context, not event-time flood truth.",
                "The Copernicus GLO-30 DSM includes buildings and vegetation; its slope is only a terrain-screening proxy.",
                "The 10 degree slope cutoff is operational and not a validated hydrological threshold.",
                "The 900 m² minimum mapping unit is an operational speckle/component filter, not a validated minimum flood size.",
                "The result is not a validated flood, inundation, or hazard classification.",
            ],
        }
    provenance: dict[str, object] = {
        "evidence_class": "derived_measurement",
        "mission": "NASA-ISRO NISAR",
        "product_family": "GCOV",
        "before_product_id": before_product_id,
        "after_product_id": after_product_id,
        "before_collection_concept_id": before_collection_concept_id,
        "after_collection_concept_id": after_collection_concept_id,
        "before_granule_concept_id": before_granule_concept_id,
        "after_granule_concept_id": after_granule_concept_id,
        "frequency": frequency,
        "polarization_term": polarization_term,
        "aoi_bounds_wgs84": list(bounds),
        "aoi_mask": {
            "applied": aoi_geojson is not None,
            "method": "pixel-centre rasterization in the projected GCOV CRS; polygon holes preserved; all_touched=false" if aoi_geojson is not None else "not supplied",
            "aoi_raster_pixels": aoi_pixel_count,
            "valid_pixel_coverage_percent": summary.get("valid_pixel_coverage_percent"),
            "coverage_scope": summary.get("valid_pixel_coverage_scope"),
        },
        "quality_diagnostics": {
            "interpretation": "Data-quality diagnostics only; not calibrated uncertainty or probability.",
            "valid_pixel_coverage_percent": summary.get("valid_pixel_coverage_percent"),
            "p10_to_p90_change_span_db": round(float(change.summary["p90_delta_db"] - change.summary["p10_delta_db"]), 4),
            "before_number_of_looks_available": bool(before.metadata.get("has_number_of_looks")),
            "after_number_of_looks_available": bool(after.metadata.get("has_number_of_looks")),
        },
        "negative_change_threshold_sensitivity": sensitivity,
        "measurement_uncertainty": uncertainty,
        "water_screening": water_screening_metadata,
        "before_grid": {
            "crs": before.crs.to_string(),
            "transform": list(before.transform)[:6],
            "shape": list(before.power.shape),
            "metadata": before.metadata,
        },
        "after_grid": {
            "crs": after.crs.to_string(),
            "transform": list(after.transform)[:6],
            "shape": list(after.power.shape),
            "metadata": after.metadata,
        },
        "compatibility": {
            "compatible": compatibility.compatible,
            "score": compatibility.score,
            "reasons": list(compatibility.reasons),
            "temporal_gap_days": compatibility.temporal_gap_days,
        },
        "method": "10*log10(after_gamma0_power) - 10*log10(before_gamma0_power)",
        "negative_backscatter_screening": {
            "file": screening_mask_path.name,
            "threshold_db": screening_threshold_db,
            "candidate_pixels": int(np.count_nonzero(change.valid_mask & (change.delta_db <= screening_threshold_db))),
            "valid_pixels": int(change.valid_mask.sum()),
            "interpretation": "Negative-change screening only; not a water/flood classification or probability.",
        },
        "preview": {
            "file": preview_path.name,
            "range_db": list(preview_range_db),
            "display_only": True,
            "georeferenced": False,
            "map_registration": "WGS84-reprojected PNG with explicit EPSG:4326 bounds stored in result provenance; the PNG itself does not embed geospatial metadata",
            "crs": "EPSG:4326",
            "bounds_wgs84": [float(value) for value in preview_bounds_wgs84],
            "bounds_source": "outer bounds of the WGS84-reprojected preview transform",
            "classification": False,
        },
        "rtc_reapplied": False,
        "alignment_policy": "Explicitly reproject the after scene to the before scene grid using bilinear resampling in linear gamma0 power, nearest-neighbour validity, and bilinear effective looks; reject extreme resolution ratios and record every transformation.",
        "after_scene_alignment": after.metadata.get("alignment", {"applied": False, "reason": "source grids already identical"}),
        "mask_policy": "Use raster nodata/masks and positive finite power; retain GCOV averaging-ensemble mask as metadata, not a guessed Boolean mask.",
        "limitations": [
            "Backscatter change is not by itself proof of flooding, landslide, deforestation, or another specific cause.",
            "No independent reference dataset or classification validation is performed by this workflow.",
            "The output contains only pixels valid in both acquisitions.",
        ],
        "summary": summary,
    }

    if progress:
        progress("publishing")
    raster_path = write_gcov_change_cog(
        change,
        transform=before.transform,
        crs=before.crs,
        output_path=output_path,
        provenance={
            "BEFORE_PRODUCT_ID": before_product_id,
            "AFTER_PRODUCT_ID": after_product_id,
            "FREQUENCY": frequency,
            "POLARIZATION_TERM": polarization_term,
            "MEASUREMENT": "after_minus_before_gamma0_backscatter",
            "UNITS": "dB",
            "AOI_MASK": "pixel-centre polygon mask" if aoi_geojson is not None else "none",
        },
    )
    if progress:
        progress("completed")
    return NISARChangeOutput(raster_path, summary, provenance, compatibility, preview_path, preview_range_db, screening_mask_path, screening_threshold_db, uncertainty_path, water_screening_mask_path)
