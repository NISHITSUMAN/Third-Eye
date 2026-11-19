import numpy as np
import pytest

from science_worker.nisar.water_detection import (
    WaterScreeningError,
    screen_candidate_new_open_water,
)


def test_screen_excludes_permanent_water_and_steep_terrain():
    delta = np.array([[-4.0, -4.0, -4.0], [-4.0, 0.0, -4.0], [-4.0, -4.0, -4.0]])
    valid = np.ones_like(delta, dtype=bool)
    permanent = np.zeros_like(valid)
    permanent[0, 0] = True
    slope = np.zeros_like(delta)
    slope[0, 1] = 18.0

    result = screen_candidate_new_open_water(
        delta,
        valid,
        threshold_db=-3.0,
        threshold_rationale="Scene-specific exploratory threshold selected for sensitivity review.",
        pixel_area_m2=100.0,
        permanent_water_mask=permanent,
        slope_degrees=slope,
        maximum_slope_degrees=10.0,
    )

    assert result.candidate_pixels == 6
    assert result.excluded_permanent_water == 1
    assert result.excluded_steep_terrain == 1
    assert result.metadata["label"] == "candidate new open water"
    assert result.metadata["not_a_flood_classification"] is True


def test_minimum_mapping_unit_removes_small_components():
    delta = np.zeros((5, 5), dtype=float)
    delta[0, 0] = -5.0
    delta[2:4, 2:4] = -5.0

    result = screen_candidate_new_open_water(
        delta,
        np.ones_like(delta, dtype=bool),
        threshold_db=-3.0,
        threshold_rationale="Synthetic fixture threshold for algorithm testing only.",
        pixel_area_m2=100.0,
        minimum_mapping_unit_m2=300.0,
    )

    assert result.candidate_pixels == 4
    assert result.removed_small_components == 1
    assert result.candidate_area_km2 == 0.0004


@pytest.mark.parametrize(
    "kwargs",
    [
        {"threshold_db": 0.0},
        {"threshold_db": -3.0, "threshold_rationale": ""},
        {"threshold_db": -3.0, "pixel_area_m2": 0.0},
    ],
)
def test_rejects_unsupported_or_incomplete_parameters(kwargs):
    params = {
        "threshold_db": -3.0,
        "threshold_rationale": "Synthetic test rationale.",
        "pixel_area_m2": 100.0,
    }
    params.update(kwargs)
    with pytest.raises(WaterScreeningError):
        screen_candidate_new_open_water(
            np.full((2, 2), -4.0),
            np.ones((2, 2), dtype=bool),
            **params,
        )


def test_rejects_misaligned_reference_layers():
    with pytest.raises(WaterScreeningError, match="Permanent-water mask"):
        screen_candidate_new_open_water(
            np.full((2, 2), -4.0),
            np.ones((2, 2), dtype=bool),
            threshold_db=-3.0,
            threshold_rationale="Synthetic test rationale.",
            pixel_area_m2=100.0,
            permanent_water_mask=np.ones((3, 3), dtype=bool),
        )
