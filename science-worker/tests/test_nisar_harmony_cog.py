from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from science_worker.nisar.gcov import GcovError, read_gcov_cog_scene, compare_gcov_scenes


def write_layer(path: Path, values: np.ndarray, *, nodata: float | None = None) -> None:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=values.shape[1],
        height=values.shape[0],
        count=1,
        dtype=values.dtype,
        crs="EPSG:32643",
        transform=from_origin(500000, 2100100, 10, 10),
        nodata=nodata,
    ) as dataset:
        dataset.write(values, 1)


def test_harmony_cog_reader_converts_gamma0_power_to_db(tmp_path: Path) -> None:
    power = tmp_path / "HHHH.tif"
    mask = tmp_path / "mask.tif"
    looks = tmp_path / "numberOfLooks.tif"
    write_layer(power, np.array([[1.0, 0.1], [10.0, 0.01]], dtype=np.float32))
    # The GCOV mask describes the averaging ensemble; it is not a Boolean
    # validity raster and must not be filtered with an arbitrary threshold.
    write_layer(mask, np.array([[0, 255], [1, 2]], dtype=np.uint8))
    write_layer(looks, np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float32))

    scene = read_gcov_cog_scene(
        power,
        frequency="frequencyA",
        polarization_term="HHHH",
        mask_path=mask,
        number_of_looks_path=looks,
    )

    assert scene.backscatter_db.tolist() == pytest.approx([[0.0, -10.0], [10.0, -20.0]])
    assert scene.valid_mask.all()
    assert scene.metadata["rtc_applied_by_source_product"] is True
    assert scene.metadata["has_mask"] is True
    assert scene.metadata["has_number_of_looks"] is True


def test_harmony_cog_reader_respects_nodata_and_rejects_misaligned_layers(tmp_path: Path) -> None:
    power = tmp_path / "HHHH.tif"
    mask = tmp_path / "mask.tif"
    looks = tmp_path / "looks.tif"
    write_layer(power, np.array([[1.0, -9999.0], [0.0, 0.1]], dtype=np.float32), nodata=-9999.0)
    write_layer(mask, np.zeros((2, 2), dtype=np.uint8))
    write_layer(looks, np.ones((2, 2), dtype=np.float32))

    scene = read_gcov_cog_scene(
        power,
        frequency="frequencyA",
        polarization_term="HHHH",
        mask_path=mask,
        number_of_looks_path=looks,
    )
    assert scene.valid_mask.tolist() == [[True, False], [False, True]]

    misaligned = tmp_path / "misaligned.tif"
    with rasterio.open(
        misaligned,
        "w",
        driver="GTiff",
        width=2,
        height=2,
        count=1,
        dtype="float32",
        crs="EPSG:32643",
        transform=from_origin(500010, 2100100, 10, 10),
    ) as dataset:
        dataset.write(np.ones((2, 2), dtype=np.float32), 1)

    with pytest.raises(GcovError, match="not aligned"):
        read_gcov_cog_scene(
            power,
            frequency="frequencyA",
            polarization_term="HHHH",
            number_of_looks_path=misaligned,
        )


def test_harmony_cog_scenes_produce_after_minus_before_change(tmp_path: Path) -> None:
    before_path = tmp_path / "before.tif"
    after_path = tmp_path / "after.tif"
    write_layer(before_path, np.array([[1.0, 0.1]], dtype=np.float32))
    write_layer(after_path, np.array([[0.1, 1.0]], dtype=np.float32))
    before = read_gcov_cog_scene(before_path, frequency="frequencyA", polarization_term="HHHH")
    after = read_gcov_cog_scene(after_path, frequency="frequencyA", polarization_term="HHHH")

    change = compare_gcov_scenes(before, after)

    assert change.delta_db.tolist() == pytest.approx([[-10.0, 10.0]])
    assert change.summary["valid_pixels"] == 2
