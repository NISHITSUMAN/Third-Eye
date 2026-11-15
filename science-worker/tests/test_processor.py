import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from science_worker.processor import (
    ProcessingError,
    Radiometry,
    _valid_pixel_size,
    _validate_geometry,
    _write_geotiff,
    compute_ndvi,
    parse_radiometry_metadata,
)


def test_ndvi_applies_product_offsets_and_masks_unreliable_scl_classes() -> None:
    red = np.array([[3000, 3000, 3000, 3000]], dtype=np.uint16)
    nir = np.array([[7000, 7000, 7000, 7000]], dtype=np.uint16)
    scl = np.array([[4, 3, 7, 11]], dtype=np.uint8)
    mask = np.ones(red.shape, dtype=bool)

    result, valid = compute_ndvi(
        red,
        nir,
        scl,
        radiometry=Radiometry(10_000, -1_000, -1_000),
        aoi_mask=mask,
        red_valid=mask,
        nir_valid=mask,
        scl_valid=mask,
    )

    assert valid.tolist() == [[True, False, False, False]]
    assert result[0, 0] == pytest.approx((0.6 - 0.2) / (0.6 + 0.2))
    assert np.all(result[0, 1:] == -9999)


def test_ndvi_fails_when_no_clear_pixels_remain() -> None:
    raw = np.full((1, 1), 3000, dtype=np.uint16)
    scl = np.array([[9]], dtype=np.uint8)
    mask = np.ones(raw.shape, dtype=bool)

    with pytest.raises(ProcessingError, match="No valid clear"):
        compute_ndvi(
            raw,
            raw,
            scl,
            radiometry=Radiometry(10_000, -1_000, -1_000),
            aoi_mask=mask,
            red_valid=mask,
            nir_valid=mask,
            scl_valid=mask,
        )


def test_radiometry_is_read_from_product_xml_not_assumed() -> None:
    metadata = b"""<root>
      <BOA_QUANTIFICATION_VALUE unit="none">10000</BOA_QUANTIFICATION_VALUE>
      <BOA_ADD_OFFSET band_id="3">-1000</BOA_ADD_OFFSET>
      <BOA_ADD_OFFSET band_id="7">-1000</BOA_ADD_OFFSET>
    </root>"""

    assert parse_radiometry_metadata(metadata) == Radiometry(10_000, -1_000, -1_000)


def test_radiometry_rejects_missing_band_offsets() -> None:
    metadata = b"""<root>
      <BOA_QUANTIFICATION_VALUE>10000</BOA_QUANTIFICATION_VALUE>
      <BOA_ADD_OFFSET band_id="3">-1000</BOA_ADD_OFFSET>
    </root>"""

    with pytest.raises(ProcessingError, match="does not report BOA offsets"):
        parse_radiometry_metadata(metadata)


def test_aoi_rejects_antimeridian_crossing_and_non_polygon_shapes() -> None:
    crossing = {
        "type": "Polygon",
        "coordinates": [[[179, 10], [-179, 10], [-179, 12], [179, 12], [179, 10]]],
    }
    point = {"type": "Point", "coordinates": [0, 0]}

    with pytest.raises(ProcessingError, match="Antimeridian"):
        _validate_geometry(crossing)
    with pytest.raises(ProcessingError, match="polygon or multipolygon"):
        _validate_geometry(point)


def test_processing_requires_the_native_sentinel2_ten_metre_grid() -> None:
    assert _valid_pixel_size(from_origin(0, 100, 10, 10)) == pytest.approx(10)
    with pytest.raises(ProcessingError, match="10 m grid"):
        _valid_pixel_size(from_origin(0, 100, 15, 15))


def test_output_is_written_as_a_cloud_optimized_geotiff(tmp_path) -> None:
    output_path = tmp_path / "ndvi.tif"
    values = np.full((32, 32), 0.4, dtype=np.float32)
    _write_geotiff(output_path, values, from_origin(500_000, 4_100_000, 10, 10), rasterio.crs.CRS.from_epsg(32610), {"SOURCE": "test"})

    with rasterio.open(output_path) as raster:
        assert raster.driver == "GTiff"
        assert raster.tags(ns="IMAGE_STRUCTURE").get("LAYOUT") == "COG"
        assert raster.crs == rasterio.crs.CRS.from_epsg(32610)
        assert raster.read(1)[0, 0] == pytest.approx(0.4)
