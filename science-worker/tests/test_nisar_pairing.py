from datetime import datetime, timedelta, timezone

import pytest

from science_worker.nisar.pairing import PairingError, assess_gcov_pair, parse_gcov_product_name


def product(start: datetime, *, track: str = "148", direction: str = "A", crid: str = "P05036", coverage: str = "F") -> str:
    end = start + timedelta(seconds=34)
    return (
        "NISAR_L2_PR_GCOV_033_" + track + "_" + direction + "_008_4005_DHDH_A_"
        + start.strftime("%Y%m%dT%H%M%S") + "_"
        + end.strftime("%Y%m%dT%H%M%S") + "_" + crid + "_N_" + coverage + "_J_001.h5"
    )


def test_parse_gcov_product_identity() -> None:
    start = datetime(2026, 11, 10, 10, 0, tzinfo=timezone.utc)
    identity = parse_gcov_product_name(product(start))
    assert identity.relative_orbit == 148
    assert identity.orbit_direction == "A"
    assert identity.primary_bandwidth_mhz == 40
    assert identity.secondary_bandwidth_mhz == 5
    assert identity.crid == "P05036"


def test_pair_accepts_matching_track_mode_and_release() -> None:
    start = datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc)
    assessment = assess_gcov_pair(
        product(start),
        product(start + timedelta(days=12)),
        frequency="frequencyA",
        polarization_term="HHHH",
    )
    assert assessment.compatible is True
    assert assessment.score == 100
    assert assessment.temporal_gap_days == pytest.approx(12)


def test_pair_rejects_different_track_and_crid() -> None:
    start = datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc)
    assessment = assess_gcov_pair(
        product(start),
        product(start + timedelta(days=12), track="149", crid="P05023"),
        frequency="frequencyA",
        polarization_term="HHHH",
    )
    assert assessment.compatible is False
    assert any("track differs" in reason for reason in assessment.reasons)
    assert any("CRID differs" in reason for reason in assessment.reasons)


def test_pair_rejects_missing_secondary_frequency() -> None:
    start = datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc)
    before = product(start).replace("_4005_", "_4000_")
    after = product(start + timedelta(days=12)).replace("_4005_", "_4000_")
    result = assess_gcov_pair(before, after, frequency="frequencyB", polarization_term="HHHH")
    assert result.compatible is False
    assert any("secondary frequency band is absent" in reason for reason in result.reasons)


def test_parse_rejects_non_product_identifier() -> None:
    with pytest.raises(PairingError):
        parse_gcov_product_name("not-a-nisar-product")
