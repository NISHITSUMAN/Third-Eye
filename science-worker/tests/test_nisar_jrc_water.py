from __future__ import annotations

import rasterio
import numpy as np
import pytest
import rasterio
from rasterio.crs import CRS
from rasterio.io import MemoryFile
from rasterio.transform import from_bounds

from science_worker.nisar.jrc_water import (
    JRCWaterContextError,
    jrc_occurrence_tile_urls,
    load_jrc_occurrence_aligned,
)


def _tile_bytes(value: int = 42) -> bytes:
    data = np.full((10, 10), value, dtype=np.uint8)
    profile = {
        "driver": "GTiff",
        "height": 10,
        "width": 10,
        "count": 1,
        "dtype": "uint8",
        "crs": "EPSG:4326",
        "transform": from_bounds(70, 10, 80, 20, 10, 10),
        "nodata": 255,
    }
    with MemoryFile() as memory:
        with memory.open(**profile) as dataset:
            dataset.write(data, 1)
        return memory.read()


def test_jrc_urls_use_northwest_10_degree_tile_names() -> None:
    urls = jrc_occurrence_tile_urls((72.0, 18.0, 74.0, 20.0))
    assert len(urls) == 1
    assert urls[0].endswith("/occurrence_70E_20N_v1_5_2024.tif")


def test_jrc_url_bounds_do_not_include_adjacent_tile_at_exact_edge() -> None:
    urls = jrc_occurrence_tile_urls((0.0, -2.0, 2.0, 0.0))
    assert len(urls) == 1
    assert urls[0].endswith("/occurrence_0E_0N_v1_5_2024.tif")


def test_jrc_occurrence_is_aligned_to_target_grid_and_provenance_is_recorded(monkeypatch) -> None:
    memory = MemoryFile(_tile_bytes(73))

    def fake_open(_path, *args, **kwargs):
        return memory.open()

    monkeypatch.setattr(rasterio, "open", fake_open)
    result = load_jrc_occurrence_aligned(
        bounds_wgs84=(72.0, 18.0, 74.0, 20.0),
        target_crs=CRS.from_epsg(4326),
        target_transform=from_bounds(72.0, 18.0, 74.0, 20.0, 2, 2),
        target_shape=(2, 2),
    )
    memory.close()

    assert result.occurrence_percent.shape == (2, 2)
    assert result.valid_mask.all()
    assert np.all(result.occurrence_percent == 73)
    assert result.provenance["version"] == "1.5"
    assert result.provenance["tiles"][0]["resampling"] == "nearest"
    assert result.provenance["attribution"] == "Source: EC JRC/Google"


def test_jrc_occurrence_rejects_unreadable_remote_tiles(monkeypatch) -> None:
    def unavailable(*_args, **_kwargs):
        raise rasterio.errors.RasterioIOError("synthetic unavailable tile")

    monkeypatch.setattr(rasterio, "open", unavailable)
    with pytest.raises(JRCWaterContextError, match="did not cover"):
        load_jrc_occurrence_aligned(
            bounds_wgs84=(72.0, 18.0, 74.0, 20.0),
            target_crs=CRS.from_epsg(4326),
            target_transform=from_bounds(72.0, 18.0, 74.0, 20.0, 2, 2),
            target_shape=(2, 2),
        )


def test_jrc_occurrence_rejects_oversized_aoi() -> None:
    with pytest.raises(JRCWaterContextError, match="2-degree"):
        jrc_occurrence_tile_urls((70.0, 10.0, 73.0, 12.0))
