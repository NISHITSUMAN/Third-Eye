from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import re


_PRODUCT_NAME = re.compile(
    r"^NISAR_(?P<instrument>[LS])(?P<level>[0-3])_(?P<processing>[A-Z]{2})_GCOV_"
    r"(?P<cycle>\d{3})_(?P<relative_orbit>\d{3})_(?P<direction>[AD])_"
    r"(?P<frame>\d{3})_(?P<mode>\d{4})_(?P<polarization>[A-Z]{4})_"
    r"(?P<source>[AM])_(?P<start>\d{8}T\d{6})_(?P<end>\d{8}T\d{6})_"
    r"(?P<crid>P\d{5})_(?P<orbit_accuracy>[PMNF])_(?P<coverage>[FP])_"
    r"(?P<location>[A-Z])_(?P<counter>\d{3})$"
)


class PairingError(ValueError):
    """Raised when a GCOV product identifier cannot be interpreted safely."""


@dataclass(frozen=True)
class GcovProductIdentity:
    product_id: str
    instrument: str
    processing_type: str
    cycle: int
    relative_orbit: int
    orbit_direction: str
    frame: int
    primary_bandwidth_mhz: int
    secondary_bandwidth_mhz: int
    primary_polarization_mode: str
    secondary_polarization_mode: str
    source_mode: str
    acquisition_start: datetime
    acquisition_end: datetime
    crid: str
    orbit_accuracy: str
    coverage: str


@dataclass(frozen=True)
class PairAssessment:
    compatible: bool
    score: int
    reasons: tuple[str, ...]
    temporal_gap_days: float


def parse_gcov_product_name(product_id: str) -> GcovProductIdentity:
    name = product_id.removesuffix(".h5")
    match = _PRODUCT_NAME.fullmatch(name)
    if not match:
        raise PairingError("The GCOV product name does not match the documented NISAR naming convention.")

    values = match.groupdict()
    try:
        start = datetime.strptime(values["start"], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        end = datetime.strptime(values["end"], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        primary_bandwidth = int(values["mode"][:2])
        secondary_bandwidth = int(values["mode"][2:])
    except ValueError as error:
        raise PairingError("The GCOV product name contains invalid acquisition metadata.") from error
    if end < start:
        raise PairingError("The GCOV product end time precedes its start time.")

    return GcovProductIdentity(
        product_id=name,
        instrument=values["instrument"],
        processing_type=values["processing"],
        cycle=int(values["cycle"]),
        relative_orbit=int(values["relative_orbit"]),
        orbit_direction=values["direction"],
        frame=int(values["frame"]),
        primary_bandwidth_mhz=primary_bandwidth,
        secondary_bandwidth_mhz=secondary_bandwidth,
        primary_polarization_mode=values["polarization"][:2],
        secondary_polarization_mode=values["polarization"][2:],
        source_mode=values["source"],
        acquisition_start=start,
        acquisition_end=end,
        crid=values["crid"],
        orbit_accuracy=values["orbit_accuracy"],
        coverage=values["coverage"],
    )


def assess_gcov_pair(
    before_id: str,
    after_id: str,
    *,
    frequency: str,
    polarization_term: str,
    minimum_gap_days: float = 1.0,
    maximum_gap_days: float = 365.0,
) -> PairAssessment:
    before = parse_gcov_product_name(before_id)
    after = parse_gcov_product_name(after_id)
    reasons: list[str] = []
    score = 100

    comparisons = (
        (before.instrument == after.instrument, "Instrument differs."),
        (before.processing_type == after.processing_type, "Processing type differs."),
        (before.relative_orbit == after.relative_orbit, "Relative orbit track differs."),
        (before.orbit_direction == after.orbit_direction, "Orbit pass direction differs."),
        (before.frame == after.frame, "Frame differs."),
        (before.primary_bandwidth_mhz == after.primary_bandwidth_mhz, "Primary bandwidth differs."),
        (before.secondary_bandwidth_mhz == after.secondary_bandwidth_mhz, "Secondary bandwidth differs."),
        (before.primary_polarization_mode == after.primary_polarization_mode, "Primary polarization mode differs."),
        (before.secondary_polarization_mode == after.secondary_polarization_mode, "Secondary polarization mode differs."),
        (before.source_mode == after.source_mode, "Acquisition source mode differs."),
        (before.crid == after.crid, "Processing CRID differs; do not mix processing releases."),
        (before.orbit_accuracy == after.orbit_accuracy, "Orbit accuracy class differs."),
    )
    for matches, reason in comparisons:
        if not matches:
            reasons.append(reason)
            score -= 12

    if frequency not in {"frequencyA", "frequencyB"}:
        reasons.append("Frequency must be frequencyA or frequencyB.")
        score = 0
    elif frequency == "frequencyA" and before.primary_bandwidth_mhz == 0:
        reasons.append("The primary frequency band is absent.")
        score = 0
    elif frequency == "frequencyB" and before.secondary_bandwidth_mhz == 0:
        reasons.append("The secondary frequency band is absent.")
        score = 0

    if not polarization_term or len(polarization_term) != 4:
        reasons.append("A valid diagonal covariance term is required.")
        score = 0

    before_mid = before.acquisition_start + (before.acquisition_end - before.acquisition_start) / 2
    after_mid = after.acquisition_start + (after.acquisition_end - after.acquisition_start) / 2
    gap_days = abs((after_mid - before_mid).total_seconds()) / 86400
    if gap_days < minimum_gap_days:
        reasons.append("Acquisitions are too close in time for the configured comparison.")
        score -= 15
    if gap_days > maximum_gap_days:
        reasons.append("Acquisitions exceed the configured maximum temporal separation.")
        score -= 15

    if before.coverage != "F" or after.coverage != "F":
        reasons.append("One or both products have partial frame coverage.")
        score -= 10

    return PairAssessment(
        compatible=not reasons,
        score=max(0, score),
        reasons=tuple(reasons) if reasons else ("Orbit, frame, mode, processing release and temporal checks passed.",),
        temporal_gap_days=gap_days,
    )
