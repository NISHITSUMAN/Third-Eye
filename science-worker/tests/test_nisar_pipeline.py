from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import rasterio
import pytest
from PIL import Image
from rasterio.transform import from_origin

import science_worker.nisar.pipeline as nisar_pipeline
from science_worker.nisar.jrc_water import JRCWaterContext, JRCWaterContextError
from science_worker.nisar.copernicus_dem import CopernicusDEMError, CopernicusSlopeContext
from science_worker.nisar.pipeline import process_gcov_change_pair


@pytest.fixture(autouse=True)
def disable_live_jrc_requests(monkeypatch):
    def unavailable(**_kwargs):
        raise JRCWaterContextError("JRC disabled in deterministic pipeline fixture.")

    monkeypatch.setattr(nisar_pipeline, "load_jrc_occurrence_aligned", unavailable)
    def dem_unavailable(**_kwargs):
        raise CopernicusDEMError("Copernicus DEM disabled in deterministic pipeline fixture.")

    monkeypatch.setattr(nisar_pipeline, "load_copernicus_slope_aligned", dem_unavailable)


def product(start: datetime) -> str:
    end = start + timedelta(seconds=34)
    return (
        "NISAR_L2_PR_GCOV_033_148_A_008_4005_DHDH_A_"
        + start.strftime("%Y%m%dT%H%M%S") + "_"
        + end.strftime("%Y%m%dT%H%M%S")
        + "_P05036_N_F_J_001.h5"
    )


def write_cog(path: Path, values: np.ndarray, *, dtype: str = "float32") -> None:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=values.shape[1],
        height=values.shape[0],
        count=1,
        dtype=dtype,
        crs="EPSG:32643",
        transform=from_origin(500000, 2100100, 10, 10),
    ) as dataset:
        dataset.write(values.astype(dtype), 1)


class FakeHarmony:
    def __init__(self, layers: list[Path]) -> None:
        self.layers = layers

    def submit(self, request):
        assert request.spatial is not None
        return "fake-job"

    def wait_for_processing(self, job_id, show_progress=False):
        assert job_id == "fake-job"

    def download_all(self, job_id, directory, overwrite):
        return [SimpleNamespace(result=lambda path=path: str(path)) for path in self.layers]


def test_pipeline_retrieves_real_harmony_layers_and_writes_delta_cog(tmp_path: Path) -> None:
    before_dir = tmp_path / "before"
    after_dir = tmp_path / "after"
    before_dir.mkdir()
    after_dir.mkdir()

    before_power = before_dir / "before_HHHH.tif"
    before_mask = before_dir / "before_mask.tif"
    before_looks = before_dir / "before_numberOfLooks.tif"
    after_power = after_dir / "after_HHHH.tif"
    after_mask = after_dir / "after_mask.tif"
    after_looks = after_dir / "after_numberOfLooks.tif"

    write_cog(before_power, np.array([[1.0, 0.1]], dtype=np.float32))
    write_cog(before_mask, np.array([[0, 255]], dtype=np.uint8), dtype="uint8")
    write_cog(before_looks, np.ones((1, 2), dtype=np.float32))
    write_cog(after_power, np.array([[0.1, 1.0]], dtype=np.float32))
    write_cog(after_mask, np.array([[0, 255]], dtype=np.uint8), dtype="uint8")
    write_cog(after_looks, np.ones((1, 2), dtype=np.float32))

    clients = iter([
        FakeHarmony([before_power, before_mask, before_looks]),
        FakeHarmony([after_power, after_mask, after_looks]),
    ])
    start = datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc)
    result = process_gcov_change_pair(
        before_product_id=product(start),
        after_product_id=product(start + timedelta(days=12)),
        before_collection_concept_id="C1234567890-ASF",
        after_collection_concept_id="C1234567890-ASF",
        before_granule_concept_id="G1234567890-ASF",
        after_granule_concept_id="G1234567891-ASF",
        bounds=(72.0, 18.0, 72.5, 18.5),
        frequency="frequencyA",
        polarization_term="HHHH",
        output_path=tmp_path / "change.tif",
        before_directory=before_dir,
        after_directory=after_dir,
        client_factory=lambda: next(clients),
    )

    assert result.summary["valid_pixels"] == 2
    assert result.summary["mean_delta_db"] == 0.0
    assert result.provenance["rtc_reapplied"] is False
    assert result.uncertainty_path is not None and result.uncertainty_path.is_file()
    assert result.provenance["after_scene_alignment"]["applied"] is False
    with Image.open(result.preview_path) as preview:
        assert preview.mode == "RGBA"
        assert preview.width > 0 and preview.height > 0
        assert max(preview.size) <= 1600
    assert result.provenance["preview"]["crs"] == "EPSG:4326"
    assert "WGS84-reprojected PNG" in result.provenance["preview"]["map_registration"]
    with rasterio.open(result.raster_path) as dataset:
        np.testing.assert_allclose(dataset.read(1), [[-10.0, 10.0]])


def test_pipeline_refuses_different_processing_releases(tmp_path: Path) -> None:
    start = datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc)
    incompatible = product(start + timedelta(days=12)).replace("P05036", "P05023")

    try:
        process_gcov_change_pair(
            before_product_id=product(start),
            after_product_id=incompatible,
            before_collection_concept_id="C1234567890-ASF",
            after_collection_concept_id="C1234567890-ASF",
            before_granule_concept_id="G1234567890-ASF",
            after_granule_concept_id="G1234567891-ASF",
            bounds=(72.0, 18.0, 72.5, 18.5),
            frequency="frequencyA",
            polarization_term="HHHH",
            output_path=tmp_path / "change.tif",
            before_directory=tmp_path / "before",
            after_directory=tmp_path / "after",
            client_factory=lambda: None,
        )
    except Exception as error:
        assert "not compatible" in str(error)
    else:
        raise AssertionError("A mixed-CRID pair must be rejected before downloading.")



def test_pipeline_masks_pixels_to_the_exact_aoi_polygon(tmp_path: Path) -> None:
    from rasterio.warp import transform_geom

    before_dir = tmp_path / "before-mask"
    after_dir = tmp_path / "after-mask"
    before_dir.mkdir()
    after_dir.mkdir()
    before_power = before_dir / "before_HHHH.tif"
    after_power = after_dir / "after_HHHH.tif"
    write_cog(before_power, np.array([[1.0, 0.1]], dtype=np.float32))
    write_cog(after_power, np.array([[0.1, 1.0]], dtype=np.float32))
    clients = iter([FakeHarmony([before_power]), FakeHarmony([after_power])])
    projected = {
        "type": "Polygon",
        "coordinates": [[[500000, 2100090], [500010, 2100090], [500010, 2100100], [500000, 2100100], [500000, 2100090]]],
    }
    aoi = transform_geom("EPSG:32643", "EPSG:4326", projected)
    start = datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc)
    result = process_gcov_change_pair(
        before_product_id=product(start),
        after_product_id=product(start + timedelta(days=12)),
        before_collection_concept_id="C1234567890-ASF",
        after_collection_concept_id="C1234567890-ASF",
        before_granule_concept_id="G1234567890-ASF",
        after_granule_concept_id="G1234567891-ASF",
        bounds=(72.0, 18.0, 72.5, 18.5),
        frequency="frequencyA",
        polarization_term="HHHH",
        output_path=tmp_path / "clipped.tif",
        before_directory=before_dir,
        after_directory=after_dir,
        client_factory=lambda: next(clients),
        aoi_geojson=aoi,
    )
    assert result.summary["aoi_raster_pixels"] == 1
    assert result.summary["valid_pixels"] == 1
    assert result.summary["valid_pixel_coverage_percent"] == 100.0
    assert result.provenance["aoi_mask"]["applied"] is True
    assert result.preview_path.is_file()
    assert result.screening_mask_path.is_file()
    with rasterio.open(result.screening_mask_path) as screening:
        screening_values = screening.read(1)
        assert screening_values[0, 0] == 1
        assert screening_values[0, 1] == screening.nodata
    preview_bounds = result.provenance["preview"]["bounds_wgs84"]
    assert len(preview_bounds) == 4
    west, south, east, north = preview_bounds
    assert all(np.isfinite(value) for value in preview_bounds)
    assert west < east and south < north
    with rasterio.open(result.raster_path) as dataset:
        values = dataset.read(1)
        assert values[0, 0] == -10.0
        assert values[0, 1] == dataset.nodata



def test_pipeline_publishes_jrc_informed_candidate_water_mask(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(nisar_pipeline, "WATER_SCREENING_MINIMUM_MAPPING_UNIT_M2", 0.0)
    before_dir = tmp_path / "before-jrc"
    after_dir = tmp_path / "after-jrc"
    before_dir.mkdir()
    after_dir.mkdir()
    before_power = before_dir / "before_HHHH.tif"
    after_power = after_dir / "after_HHHH.tif"
    write_cog(before_power, np.array([[1.0, 0.1]], dtype=np.float32))
    write_cog(after_power, np.array([[0.1, 0.01]], dtype=np.float32))
    clients = iter([FakeHarmony([before_power]), FakeHarmony([after_power])])

    def fake_jrc_context(**_kwargs):
        return JRCWaterContext(
            occurrence_percent=np.array([[0.0, 95.0]], dtype=np.float32),
            valid_mask=np.ones((1, 2), dtype=bool),
            provenance={"source": "synthetic JRC fixture", "version": "1.5"},
        )

    monkeypatch.setattr(nisar_pipeline, "load_jrc_occurrence_aligned", fake_jrc_context)
    start = datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc)
    result = process_gcov_change_pair(
        before_product_id=product(start),
        after_product_id=product(start + timedelta(days=12)),
        before_collection_concept_id="C1234567890-ASF",
        after_collection_concept_id="C1234567890-ASF",
        before_granule_concept_id="G1234567890-ASF",
        after_granule_concept_id="G1234567891-ASF",
        bounds=(72.0, 18.0, 72.5, 18.5),
        frequency="frequencyA",
        polarization_term="HHHH",
        output_path=tmp_path / "jrc-change.tif",
        before_directory=before_dir,
        after_directory=after_dir,
        client_factory=lambda: next(clients),
    )

    assert result.water_screening_mask_path is not None
    assert result.water_screening_mask_path.is_file()
    assert result.provenance["water_screening"]["status"] == "provisional_screening"
    assert result.provenance["water_screening"]["historical_water_context"]["version"] == "1.5"
    manifest = result.provenance["report_manifest"]
    assert manifest["schema_version"] == "1.0"
    assert manifest["inputs"]["before_product_id"] == product(start)
    assert "candidate_new_water_screening_cog" in manifest["outputs"]
    assert len(manifest["outputs"]["change_cog"]["sha256"]) == 64
    assert manifest["outputs"]["change_cog"]["size_bytes"] > 0
    with rasterio.open(result.water_screening_mask_path) as dataset:
        np.testing.assert_array_equal(dataset.read(1), [[1, 0]])
        assert dataset.tags(1)["classification"] == "not a validated flood or inundation classification"



def test_pipeline_applies_aligned_copernicus_slope_screen(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(nisar_pipeline, "WATER_SCREENING_MINIMUM_MAPPING_UNIT_M2", 0.0)
    before_dir = tmp_path / "before-slope"
    after_dir = tmp_path / "after-slope"
    before_dir.mkdir()
    after_dir.mkdir()
    before_power = before_dir / "before_HHHH.tif"
    after_power = after_dir / "after_HHHH.tif"
    write_cog(before_power, np.array([[1.0, 0.1]], dtype=np.float32))
    write_cog(after_power, np.array([[0.1, 0.01]], dtype=np.float32))
    clients = iter([FakeHarmony([before_power]), FakeHarmony([after_power])])

    monkeypatch.setattr(
        nisar_pipeline,
        "load_jrc_occurrence_aligned",
        lambda **_kwargs: JRCWaterContext(
            occurrence_percent=np.zeros((1, 2), dtype=np.float32),
            valid_mask=np.ones((1, 2), dtype=bool),
            provenance={"source": "synthetic JRC fixture", "version": "1.5"},
        ),
    )
    monkeypatch.setattr(
        nisar_pipeline,
        "load_copernicus_slope_aligned",
        lambda **_kwargs: CopernicusSlopeContext(
            slope_degrees=np.array([[0.0, 20.0]], dtype=np.float32),
            valid_mask=np.ones((1, 2), dtype=bool),
            provenance={"source": "synthetic Copernicus GLO-30 fixture"},
        ),
    )
    start = datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc)
    result = process_gcov_change_pair(
        before_product_id=product(start),
        after_product_id=product(start + timedelta(days=12)),
        before_collection_concept_id="C1234567890-ASF",
        after_collection_concept_id="C1234567890-ASF",
        before_granule_concept_id="G1234567890-ASF",
        after_granule_concept_id="G1234567891-ASF",
        bounds=(72.0, 18.0, 72.5, 18.5),
        frequency="frequencyA",
        polarization_term="HHHH",
        output_path=tmp_path / "slope-change.tif",
        before_directory=before_dir,
        after_directory=after_dir,
        client_factory=lambda: next(clients),
    )

    assert result.water_screening_mask_path is not None
    assert result.provenance["water_screening"]["screening_parameters"]["slope_filter_applied"] is True
    assert result.provenance["water_screening"]["excluded_steep_terrain_pixels"] == 1
    with rasterio.open(result.water_screening_mask_path) as dataset:
        np.testing.assert_array_equal(dataset.read(1), [[1, 0]])
