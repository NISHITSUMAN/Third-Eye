import json

import numpy as np
import pytest
from rasterio.crs import CRS
from rasterio.transform import from_origin

from science_worker.nisar.gcov import GcovError, write_candidate_new_open_water_geojson


def test_candidate_water_geojson_contains_only_valid_connected_components(tmp_path) -> None:
    candidate = np.array(
        [[1, 1, 0, 0], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 0]],
        dtype=bool,
    )
    valid = np.ones_like(candidate)
    valid[0, 1] = False
    original = candidate.copy()
    output = write_candidate_new_open_water_geojson(
        candidate,
        screening_valid_mask=valid,
        transform=from_origin(73.0, 19.2, 0.01, 0.01),
        crs=CRS.from_epsg(4326),
        output_path=tmp_path / "candidate.geojson",
        properties={
            "radar_threshold_db": -3.0,
            "historical_occurrence_exclusion_percent": 90.0,
            "provisional": True,
        },
    )

    payload = json.loads(output.read_text())
    assert payload["type"] == "FeatureCollection"
    assert len(payload["features"]) == 2
    assert payload["metadata"]["coordinate_reference_system"] == "OGC:CRS84"
    assert all(feature["properties"]["status"] == "provisional_unvalidated" for feature in payload["features"])
    np.testing.assert_array_equal(candidate, original)


def test_candidate_water_geojson_enforces_feature_limit(tmp_path) -> None:
    candidate = np.array([[1, 0, 1]], dtype=bool)
    with pytest.raises(GcovError, match="feature limit"):
        write_candidate_new_open_water_geojson(
            candidate,
            screening_valid_mask=np.ones_like(candidate),
            transform=from_origin(73.0, 19.2, 0.01, 0.01),
            crs=CRS.from_epsg(4326),
            output_path=tmp_path / "candidate.geojson",
            properties={},
            maximum_features=1,
        )


def test_candidate_water_geojson_rejects_misaligned_masks(tmp_path) -> None:
    with pytest.raises(GcovError, match="aligned two-dimensional"):
        write_candidate_new_open_water_geojson(
            np.ones((2, 2), dtype=bool),
            screening_valid_mask=np.ones((1, 2), dtype=bool),
            transform=from_origin(73.0, 19.2, 0.01, 0.01),
            crs=CRS.from_epsg(4326),
            output_path=tmp_path / "candidate.geojson",
            properties={},
        )
