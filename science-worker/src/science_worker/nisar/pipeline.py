from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
from rasterio.features import geometry_mask
from rasterio.warp import transform_geom
import re

from .access import request_gcov_subset
from .gcov import GcovChange, GcovScene, compare_gcov_scenes, read_gcov_cog_scene, write_gcov_change_cog, write_gcov_change_preview
from .validation import negative_backscatter_threshold_sensitivity
from .pairing import PairAssessment, assess_gcov_pair


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
        } if aoi_pixel_count is not None else {}),
    }
    sensitivity = negative_backscatter_threshold_sensitivity(change.delta_db, change.valid_mask, [-1.0, -3.0, -6.0])
    preview_path, preview_range_db = write_gcov_change_preview(
        change,
        output_path=Path(output_path).with_name("nisar-gcov-change-preview.png"),
    )
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
        },
        "quality_diagnostics": {
            "interpretation": "Data-quality diagnostics only; not calibrated uncertainty or probability.",
            "valid_pixel_coverage_percent": summary.get("valid_pixel_coverage_percent"),
            "p10_to_p90_change_span_db": round(float(change.summary["p90_delta_db"] - change.summary["p10_delta_db"]), 4),
            "before_number_of_looks_available": bool(before.metadata.get("has_number_of_looks")),
            "after_number_of_looks_available": bool(after.metadata.get("has_number_of_looks")),
        },
        "negative_change_threshold_sensitivity": sensitivity,
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
        "preview": {
            "file": preview_path.name,
            "range_db": list(preview_range_db),
            "display_only": True,
            "georeferenced": False,
            "classification": False,
        },
        "rtc_reapplied": False,
        "alignment_policy": "Reject non-identical CRS, transform, or dimensions; no silent resampling.",
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
    return NISARChangeOutput(raster_path, summary, provenance, compatibility, preview_path, preview_range_db)
