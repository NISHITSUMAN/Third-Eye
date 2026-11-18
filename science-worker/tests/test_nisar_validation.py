import numpy as np
import pytest

from science_worker.nisar.validation import (
    ValidationError,
    evaluate_binary_reference,
    negative_backscatter_threshold_sensitivity,
)


def test_binary_reference_metrics_use_only_valid_reference_pixels() -> None:
    prediction = np.array([[1, 1, 0], [0, 1, 0]], dtype=np.uint8)
    reference = np.array([[1, 0, 0], [1, 1, 0]], dtype=np.uint8)
    valid = np.array([[1, 1, 1], [0, 1, 0]], dtype=bool)

    result = evaluate_binary_reference(prediction, reference, valid_mask=valid)

    assert result.true_positive == 2
    assert result.false_positive == 1
    assert result.true_negative == 1
    assert result.false_negative == 0
    assert result.evaluated_pixels == 4
    assert result.precision == pytest.approx(2 / 3)
    assert result.recall == pytest.approx(1.0)
    assert result.f1 == pytest.approx(0.8)
    assert result.intersection_over_union == pytest.approx(2 / 3)


def test_binary_validation_refuses_empty_or_misaligned_reference() -> None:
    with pytest.raises(ValidationError, match="No pixels"):
        evaluate_binary_reference(np.zeros((2, 2)), np.zeros((2, 2)), valid_mask=np.zeros((2, 2)))
    with pytest.raises(ValidationError, match="same-shaped"):
        evaluate_binary_reference(np.zeros((2, 2)), np.zeros((2, 3)))


def test_negative_delta_threshold_sensitivity_reports_counts_not_confidence() -> None:
    delta = np.array([[-4.0, -2.0, -0.5], [1.0, np.nan, -3.0]])
    valid = np.isfinite(delta)
    result = negative_backscatter_threshold_sensitivity(delta, valid, [-1.0, -3.0, -1.0])

    assert result == [
        {"threshold_db": -1.0, "candidate_pixels": 3, "valid_pixels": 5},
        {"threshold_db": -3.0, "candidate_pixels": 2, "valid_pixels": 5},
    ]
    with pytest.raises(ValidationError, match="below 0"):
        negative_backscatter_threshold_sensitivity(delta, valid, [1.0])
