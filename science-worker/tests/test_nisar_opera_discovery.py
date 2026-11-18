from __future__ import annotations

import json

import httpx
import pytest

from science_worker.nisar.opera_discovery import (
    OPERAReferenceError,
    discover_and_download_opera_dswx_s1,
)


def _item(*, concept="G123456789-POCLOUD", acquired="2026-11-18T10:00:00Z"):
    return {
        "meta": {"concept-id": concept},
        "umm": {
            "GranuleUR": "OPERA_L3_DSWX-S1_V1_20261118T100000Z_T00_WTR",
            "TemporalExtent": {"RangeDateTime": {"BeginningDateTime": acquired}},
            "RelatedUrls": [{
                "URL": "https://archive.podaac.earthdata.nasa.gov/podaac-ops-cumulus-protected/OPERA_L3_DSWX-S1_V1/test_WTR.tif",
                "Type": "GET DATA",
            }],
        },
    }


def test_returns_none_when_cmr_has_no_time_and_space_match(tmp_path):
    def handler(request):
        return httpx.Response(200, json={"items": []})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = discover_and_download_opera_dswx_s1(
            bounds_wgs84=(72.0, 18.0, 73.0, 19.0),
            target_acquired_at="2026-11-18T10:00:00Z",
            output_directory=tmp_path,
            client=client,
        )
    assert result is None


def test_refuses_download_without_worker_earthdata_token(tmp_path, monkeypatch):
    monkeypatch.delenv("EARTHDATA_TOKEN", raising=False)

    def handler(request):
        return httpx.Response(200, json={"items": [_item()]})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(OPERAReferenceError, match="EARTHDATA_TOKEN"):
            discover_and_download_opera_dswx_s1(
                bounds_wgs84=(72.0, 18.0, 73.0, 19.0),
                target_acquired_at="2026-11-18T10:00:00Z",
                output_directory=tmp_path,
                client=client,
            )


def test_selects_nearest_time_match_and_downloads_wtr(tmp_path, monkeypatch):
    monkeypatch.setenv("EARTHDATA_TOKEN", "test-token")
    downloaded = []

    def handler(request):
        if request.url.host == "cmr.earthdata.nasa.gov":
            return httpx.Response(200, json={"items": [
                _item(concept="G123456789-POCLOUD", acquired="2026-11-18T09:00:00Z"),
                _item(concept="G987654321-POCLOUD", acquired="2026-11-18T11:30:00Z"),
            ]})
        downloaded.append(request.headers.get("Authorization"))
        return httpx.Response(200, content=b"not-a-real-geotiff")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = discover_and_download_opera_dswx_s1(
            bounds_wgs84=(72.0, 18.0, 73.0, 19.0),
            target_acquired_at="2026-11-18T10:00:00Z",
            output_directory=tmp_path,
            client=client,
        )
    assert result is not None
    assert result.granule_concept_id == "G123456789-POCLOUD"
    assert result.path.read_bytes() == b"not-a-real-geotiff"
    assert downloaded == ["Bearer test-token"]


def test_rejects_temporal_gap_outside_allowed_window(tmp_path):
    def handler(request):
        return httpx.Response(200, json={"items": [_item(acquired="2026-11-10T10:00:00Z")]})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = discover_and_download_opera_dswx_s1(
            bounds_wgs84=(72.0, 18.0, 73.0, 19.0),
            target_acquired_at="2026-11-18T10:00:00Z",
            output_directory=tmp_path,
            maximum_temporal_separation_hours=72,
            client=client,
        )
    assert result is None
