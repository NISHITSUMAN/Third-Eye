from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np


class ValidationError(ValueError):
    """Raised when reference and prediction data cannot be compared defensibly."""


@dataclass(frozen=True)
class BinaryValidationMetrics:
    true_positive: int
    false_positive: int
    true_negative: int
    false_negative: int
    evaluated_pixels: int
    precision: float | None
    recall: float | None
    f1: float | None
    intersection_over_union: float | None


def evaluate_binary_reference(
    prediction: np.ndarray,
    reference: np.ndarray,
    *,
    valid_mask: np.ndarray | None = None,
) -> BinaryValidationMetrics:
    """Evaluate a binary prediction against an independently supplied reference.

    Inputs must already be spatially and temporally matched by the caller.
    This function does not infer a reference, align grids, tune thresholds, or
    treat missing reference pixels as negatives.
    """
    predicted = np.asarray(prediction)
    observed = np.asarray(reference)
    if predicted.shape != observed.shape or predicted.ndim != 2:
        raise ValidationError("Prediction and reference must be same-shaped two-dimensional arrays.")
    if valid_mask is None:
        valid = np.ones(predicted.shape, dtype=bool)
    else:
        valid = np.asarray(valid_mask, dtype=bool).copy()
        if valid.shape != predicted.shape:
            raise ValidationError("The validation mask must match the prediction/reference grid.")

    if not np.any(valid):
        raise ValidationError("No pixels have valid independent reference coverage.")
    if not np.all(np.isin(predicted[valid], [0, 1, False, True])):
        raise ValidationError("Predicted classes must be binary (0/1) over evaluated pixels.")
    if not np.all(np.isin(observed[valid], [0, 1, False, True])):
        raise ValidationError("Reference classes must be binary (0/1) over evaluated pixels.")

    pred = predicted[valid].astype(bool)
    ref = observed[valid].astype(bool)
    tp = int(np.count_nonzero(pred & ref))
    fp = int(np.count_nonzero(pred & ~ref))
    tn = int(np.count_nonzero(~pred & ~ref))
    fn = int(np.count_nonzero(~pred & ref))

    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision is not None and recall is not None and precision + recall > 0
        else (0.0 if precision == 0 and recall == 0 else None)
    )
    union = tp + fp + fn
    iou = tp / union if union else None

    return BinaryValidationMetrics(
        true_positive=tp,
        false_positive=fp,
        true_negative=tn,
        false_negative=fn,
        evaluated_pixels=int(valid.sum()),
        precision=precision,
        recall=recall,
        f1=f1,
        intersection_over_union=iou,
    )


def negative_backscatter_threshold_sensitivity(
    delta_db: np.ndarray,
    valid_mask: np.ndarray,
    thresholds_db: Iterable[float],
) -> list[dict[str, float | int]]:
    """Report pixel counts for negative-delta candidate thresholds.

    This is a sensitivity diagnostic only. It does not identify water or
    flooding and does not select a scientifically calibrated threshold.
    """
    delta = np.asarray(delta_db, dtype=np.float64)
    valid = np.asarray(valid_mask, dtype=bool)
    if delta.ndim != 2 or valid.shape != delta.shape:
        raise ValidationError("Delta raster and validity mask must be same-shaped two-dimensional arrays.")
    valid &= np.isfinite(delta)
    if not valid.any():
        raise ValidationError("No valid change pixels are available for threshold sensitivity.")

    output: list[dict[str, float | int]] = []
    seen: set[float] = set()
    for raw in thresholds_db:
        threshold = float(raw)
        if not np.isfinite(threshold) or threshold >= 0:
            raise ValidationError("Negative-backscatter thresholds must be finite values below 0 dB.")
        if threshold in seen:
            continue
        seen.add(threshold)
        output.append({
            "threshold_db": threshold,
            "candidate_pixels": int(np.count_nonzero(valid & (delta <= threshold))),
            "valid_pixels": int(valid.sum()),
        })
    if not output:
        raise ValidationError("Provide at least one negative-backscatter threshold.")
    return output
