import numpy as np
import pytest

from science_worker.nisar.copernicus_dem import (
    CopernicusDEMError,
    calculate_slope_degrees,
    copernicus_dem_tile_urls,
)


def test_copernicus_dem_tile_url_uses_one_degree_southwest_tile_name() -> None:
    urls = copernicus_dem_tile_urls((72.2, 18.1, 72.8, 18.9))
    assert len(urls) == 1
    assert urls[0].endswith(
        "/Copernicus_DSM_COG_10_N18_00_E072_00_DEM/"
        "Copernicus_DSM_COG_10_N18_00_E072_00_DEM.tif"
    )


def test_copernicus_dem_bounds_exclude_adjacent_tiles_on_exact_edges() -> None:
    urls = copernicus_dem_tile_urls((72.0, 18.0, 73.0, 19.0))
    assert len(urls) == 1
    assert "N18_00_E072_00" in urls[0]


def test_slope_is_calculated_in_projected_metres() -> None:
    elevation = np.array([[0.0, 10.0], [0.0, 10.0]], dtype=np.float32)
    slope, valid = calculate_slope_degrees(
        elevation,
        np.ones((2, 2), dtype=bool),
        pixel_size_x_m=10.0,
        pixel_size_y_m=10.0,
    )
    assert valid.all()
    np.testing.assert_allclose(slope, np.full((2, 2), 45.0), atol=1e-4)


def test_slope_marks_invalid_elevation_as_nodata() -> None:
    elevation = np.array([[0.0, 10.0], [0.0, 10.0]], dtype=np.float32)
    valid_input = np.array([[True, False], [True, False]])
    slope, valid = calculate_slope_degrees(
        elevation,
        valid_input,
        pixel_size_x_m=10.0,
        pixel_size_y_m=10.0,
    )
    assert not valid.any()
    assert np.isnan(slope).all()


def test_slope_rejects_misaligned_or_invalid_inputs() -> None:
    with pytest.raises(CopernicusDEMError, match="aligned two-dimensional"):
        calculate_slope_degrees(
            np.ones((2, 2)),
            np.ones((3, 3), dtype=bool),
            pixel_size_x_m=10.0,
            pixel_size_y_m=10.0,
        )
    with pytest.raises(CopernicusDEMError, match="positive metres"):
        calculate_slope_degrees(
            np.ones((2, 2)),
            np.ones((2, 2), dtype=bool),
            pixel_size_x_m=0.0,
            pixel_size_y_m=10.0,
        )
