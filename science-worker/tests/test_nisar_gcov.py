from pathlib import Path

import h5py
import numpy as np
import pytest
import rasterio
from rasterio.transform import Affine

from science_worker.nisar.gcov import (
    GcovError,
    compare_gcov_scenes,
    read_gcov_scene,
    write_gcov_change_cog,
)


def make_gcov(path: Path, power: np.ndarray, *, epsg: int = 32643, x0: float = 500005, y0: float = 2100095) -> None:
    with h5py.File(path, "w") as product:
        grid = product.create_group("science/LSAR/GCOV/grids/frequencyA")
        grid.create_dataset("HHHH", data=power.astype(np.float32))
        grid.create_dataset("mask", data=np.array([[1, 1, 0], [1, 1, 255]], dtype=np.uint8))
        grid.create_dataset("numberOfLooks", data=np.ones(power.shape, dtype=np.float32))
        grid.create_dataset("xCoordinates", data=np.array([x0, x0 + 10, x0 + 20], dtype=np.float64))
        grid.create_dataset("yCoordinates", data=np.array([y0, y0 - 10], dtype=np.float64))
        grid.create_dataset("xCoordinateSpacing", data=np.float64(10))
        grid.create_dataset("yCoordinateSpacing", data=np.float64(-10))
        projection = grid.create_dataset("projection", data=np.uint32(epsg))
        projection.attrs["epsg_code"] = epsg
        projection.attrs["grid_mapping_name"] = "transverse_mercator"


def test_gcov_power_is_converted_to_db_without_applying_rtc_again(tmp_path: Path) -> None:
    path = tmp_path / "before.h5"
    make_gcov(path, np.array([[1.0, 0.1, 0.2], [10.0, 0.01, 0.5]]))

    scene = read_gcov_scene(path)

    assert scene.metadata["rtc_applied_by_source_product"] is True
    assert scene.metadata["radiometry"] == "gamma0_power"
    assert scene.backscatter_db[0, 0] == pytest.approx(0.0)
    assert scene.backscatter_db[0, 1] == pytest.approx(-10.0)
    # GCOV mask is averaging-ensemble metadata, not a Boolean validity mask.\n    assert scene.valid_mask.tolist() == [[True, True, True], [True, True, True]]
    assert scene.transform == Affine(10, 0, 500000, 0, -10, 2100100)


def test_gcov_rejects_unavailable_polarization(tmp_path: Path) -> None:
    path = tmp_path / "scene.h5"
    make_gcov(path, np.ones((2, 3), dtype=np.float32))

    with pytest.raises(GcovError, match="unavailable"):
        read_gcov_scene(path, polarization_term="VVVV")


def test_gcov_change_is_after_minus_before_and_uses_common_valid_pixels(tmp_path: Path) -> None:
    before_path = tmp_path / "before.h5"
    after_path = tmp_path / "after.h5"
    make_gcov(before_path, np.ones((2, 3), dtype=np.float32))
    make_gcov(after_path, np.full((2, 3), 10.0, dtype=np.float32))

    before = read_gcov_scene(before_path)
    after = read_gcov_scene(after_path)
    result = compare_gcov_scenes(before, after)

    assert result.valid_mask.sum() == 6
    assert np.allclose(result.delta_db[result.valid_mask], 10.0)
    assert result.summary["mean_delta_db"] == pytest.approx(10.0)


def test_gcov_pair_rejects_misaligned_grids(tmp_path: Path) -> None:
    before_path = tmp_path / "before.h5"
    after_path = tmp_path / "after.h5"
    make_gcov(before_path, np.ones((2, 3), dtype=np.float32))
    make_gcov(after_path, np.full((2, 3), 2.0, dtype=np.float32), x0=500015)

    with pytest.raises(GcovError, match="not aligned"):
        compare_gcov_scenes(read_gcov_scene(before_path), read_gcov_scene(after_path))


def test_gcov_change_cog_contains_real_grid_and_nodata(tmp_path: Path) -> None:
    before_path = tmp_path / "before.h5"
    after_path = tmp_path / "after.h5"
    make_gcov(before_path, np.ones((2, 3), dtype=np.float32))
    make_gcov(after_path, np.full((2, 3), 10.0, dtype=np.float32))
    before = read_gcov_scene(before_path)
    change = compare_gcov_scenes(before, read_gcov_scene(after_path))
    output = write_gcov_change_cog(
        change,
        transform=before.transform,
        crs=before.crs,
        output_path=tmp_path / "change.tif",
        provenance={"BEFORE_PRODUCT": before.source_id, "AFTER_PRODUCT": "after.h5"},
    )

    with rasterio.open(output) as raster:
        assert raster.crs.to_epsg() == 32643
        assert raster.nodata == -9999.0
        assert raster.read(1)[0, 0] == pytest.approx(10.0)
        assert raster.read(1)[0, 2] == pytest.approx(10.0)
