from __future__ import annotations

import os
from pathlib import Path

import pytest
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_bounds
from rasterio.windows import from_bounds as window_from_bounds
from rasterio.warp import transform_bounds

from science_worker.nisar.copernicus_dem import load_copernicus_slope_aligned
from science_worker.nisar.jrc_water import load_jrc_occurrence_aligned


pytestmark = pytest.mark.skipif(
    os.environ.get("THIRD_EYE_LIVE_CONTEXT_SMOKE") != "1",
    reason="Set THIRD_EYE_LIVE_CONTEXT_SMOKE=1 to exercise public live raster sources.",
)


def test_live_jrc_gsw_v15_occurrence_tile_is_retrievable_and_readable(tmp_path: Path) -> None:
    bounds = (72.1, 18.1, 72.2, 18.2)
    from science_worker.nisar.jrc_water import jrc_occurrence_tile_urls

    url = jrc_occurrence_tile_urls(bounds)[0]
    with rasterio.Env(CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        with rasterio.open("/vsicurl/" + url) as source:
            window = window_from_bounds(*bounds, source.transform).round_offsets().round_lengths()
            sample = source.read(1, window=window)
            print({
                "jrc_bounds": tuple(source.bounds),
                "jrc_transform": tuple(source.transform)[:6],
                "jrc_nodata": source.nodata,
                "jrc_dtype": source.dtypes[0],
                "jrc_sample_shape": sample.shape,
                "jrc_sample_min": int(sample.min()) if sample.size else None,
                "jrc_sample_max": int(sample.max()) if sample.size else None,
                "jrc_sample_values": [int(value) for value in __import__("numpy").unique(sample)[:10]],
            })
    result = load_jrc_occurrence_aligned(
        bounds_wgs84=bounds,
        target_crs=CRS.from_epsg(4326),
        target_transform=from_bounds(*bounds, 8, 8),
        target_shape=(8, 8),
    )
    assert result.valid_mask.any()
    assert result.provenance["version"] == "1.5"
    assert result.provenance["tiles"]


def test_live_copernicus_glo30_tile_is_retrievable_and_readable() -> None:
    bounds = (72.1, 18.1, 72.2, 18.2)
    target_crs = CRS.from_epsg(32643)
    projected = transform_bounds("EPSG:4326", target_crs, *bounds, densify_pts=21)
    result = load_copernicus_slope_aligned(
        bounds_wgs84=bounds,
        target_crs=target_crs,
        target_transform=from_bounds(*projected, 64, 64),
        target_shape=(64, 64),
    )
    assert result.valid_mask.any()
    assert result.provenance["source"] == "Copernicus DEM GLO-30 Public"
    assert result.provenance["tiles"]
