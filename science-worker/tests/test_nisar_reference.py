from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from science_worker.nisar.reference import (
    ReferenceRasterError,
    reference_agreement_to_dict,
    validate_candidate_mask_against_reference,
    validate_against_opera_dswx_s1_wtr,
)


def write_raster(path, values, *, nodata=None):
    values = np.asarray(values, dtype=np.uint8)
    with rasterio.open(
        path, "w", driver="GTiff", height=values.shape[0], width=values.shape[1],
        count=1, dtype=values.dtype, crs="EPSG:4326",
        transform=from_origin(72, 22, 0.01, 0.01), nodata=nodata,
    ) as dataset:
        dataset.write(values, 1)


def test_validates_only_explicit_reference_classes_and_reports_metrics(tmp_path):
    candidate = tmp_path / "candidate.tif"
    reference = tmp_path / "opera-reference.tif"
    write_raster(candidate, [[1, 0], [1, 0]], nodata=255)
    write_raster(reference, [[2, 1], [1, 2]], nodata=255)
    target = datetime(2026, 11, 18, 10, tzinfo=timezone.utc)
    observed = target + timedelta(hours=12)

    report = validate_candidate_mask_against_reference(
        candidate, reference,
        reference_source="NASA/JPL OPERA",
        reference_product="OPERA DSWx-S1",
        target_acquired_at=target.isoformat(),
        reference_acquired_at=observed.isoformat(),
        water_class_values=[2],
        land_class_values=[1],
    )

    assert report.evaluated_pixels == 4
    assert report.metrics.true_positive == 1
    assert report.metrics.false_positive == 1
    assert report.metrics.true_negative == 1
    assert report.metrics.false_negative == 1
    assert report.metrics.f1 == 0.5
    assert reference_agreement_to_dict(report)["reference_product"] == "OPERA DSWx-S1"


def test_rejects_temporally_distant_reference(tmp_path):
    candidate = tmp_path / "candidate.tif"
    reference = tmp_path / "reference.tif"
    write_raster(candidate, [[1, 0], [1, 0]], nodata=255)
    write_raster(reference, [[2, 1], [1, 2]], nodata=255)
    with pytest.raises(ReferenceRasterError, match="exceeding"):
        validate_candidate_mask_against_reference(
            candidate, reference,
            reference_source="NASA/JPL OPERA", reference_product="DSWx-S1",
            target_acquired_at="2026-11-18T10:00:00Z",
            reference_acquired_at="2026-11-25T10:00:00Z",
            water_class_values=[2], land_class_values=[1],
        )


def test_rejects_ambiguous_unmapped_reference_codes(tmp_path):
    candidate = tmp_path / "candidate.tif"
    reference = tmp_path / "reference.tif"
    write_raster(candidate, [[1, 0], [1, 0]], nodata=255)
    write_raster(reference, [[3, 3], [3, 3]], nodata=255)
    with pytest.raises(ReferenceRasterError, match="no common valid pixels"):
        validate_candidate_mask_against_reference(
            candidate, reference,
            reference_source="Reference agency", reference_product="Classified water map",
            target_acquired_at="2026-11-18T10:00:00Z",
            reference_acquired_at="2026-11-18T11:00:00Z",
            water_class_values=[2], land_class_values=[1],
        )



def test_opera_wtr_wrapper_uses_documented_water_and_mask_classes(tmp_path):
    candidate = tmp_path / "candidate.tif"
    reference = tmp_path / "opera-wtr.tif"
    write_raster(candidate, [[1, 0], [1, 0]], nodata=255)
    write_raster(reference, [[1, 0], [3, 250]], nodata=255)

    report = validate_against_opera_dswx_s1_wtr(
        candidate, reference,
        target_acquired_at="2026-11-18T10:00:00Z",
        reference_acquired_at="2026-11-18T12:00:00Z",
    )

    assert report.reference_product == "OPERA_L3_DSWX-S1_V1 WTR"
    assert report.water_class_values == (1, 3)
    assert report.land_class_values == (0,)
    assert report.excluded_class_values == (250, 251, 255)
    assert report.evaluated_pixels == 3
