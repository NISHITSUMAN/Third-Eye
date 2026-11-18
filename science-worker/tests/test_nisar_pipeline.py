from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import rasterio
from rasterio.transform import from_origin

from science_worker.nisar.pipeline import process_gcov_change_pair


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
    preview_bounds = result.provenance["preview"]["bounds_wgs84"]
    assert len(preview_bounds) == 4
    west, south, east, north = preview_bounds
    assert all(np.isfinite(value) for value in preview_bounds)
    assert west < east and south < north
    with rasterio.open(result.raster_path) as dataset:
        values = dataset.read(1)
        assert values[0, 0] == -10.0
        assert values[0, 1] == dataset.nodata
