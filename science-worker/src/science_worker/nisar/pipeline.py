from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable
import re

from rasterio.crs import CRS

from .access import request_gcov_subset
from .gcov import GcovChange, GcovScene, compare_gcov_scenes, read_gcov_cog_scene, write_gcov_change_cog
from .pairing import PairAssessment, assess_gcov_pair


class NISARProcessingError(RuntimeError):
    """Raised when a real NISAR GCOV pair cannot be processed safely."""


@dataclass(frozen=True)
class NISARChangeOutput:
    raster_path: Path
    summary: dict[str, float | int]
    provenance: dict[str, object]
    compatibility: PairAssessment


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

    pixel_area_m2 = abs(float(before.transform.a * before.transform.e))
    summary = {
        **change.summary,
        "valid_area_km2": round(change.summary["valid_pixels"] * pixel_area_m2 / 1_000_000, 6),
        "pixel_area_m2": pixel_area_m2,
        "measurement": "after-minus-before gamma0 backscatter change",
        "unit": "dB",
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
        },
    )
    if progress:
        progress("completed")
    return NISARChangeOutput(raster_path, summary, provenance, compatibility)
