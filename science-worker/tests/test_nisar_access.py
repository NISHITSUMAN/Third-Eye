from pathlib import Path
from types import SimpleNamespace

import pytest

from science_worker.nisar.access import NISARAccessError, request_gcov_subset


class FakeHarmony:
    def __init__(self, outputs: list[Path]) -> None:
        self.outputs = outputs
        self.request = None

    def submit(self, request):
        self.request = request
        return "harmony-job-id"

    def wait_for_processing(self, job_id, show_progress=False):
        assert job_id == "harmony-job-id"
        assert show_progress is False

    def download_all(self, job_id, directory, overwrite):
        return [SimpleNamespace(result=lambda path=path: str(path)) for path in self.outputs]


def test_harmony_request_selects_only_requested_gcov_layers_and_aoi(tmp_path: Path) -> None:
    term = tmp_path / "HHHH.tif"
    mask = tmp_path / "mask.tif"
    looks = tmp_path / "numberOfLooks.tif"
    for path in (term, mask, looks):
        path.write_bytes(b"synthetic fixture")
    client = FakeHarmony([term, mask, looks])

    result = request_gcov_subset(
        collection_concept_id="C1234567890-ASF",
        granule_concept_id="G1234567890-ASF",
        bounds=(72.0, 18.0, 72.5, 18.5),
        frequency="frequencyA",
        polarization_term="HHHH",
        output_directory=tmp_path / "out",
        client=client,
    )

    assert result == [term, mask, looks]
    assert client.request.variables == [
        "/science/LSAR/GCOV/grids/frequencyA/HHHH",
        "/science/LSAR/GCOV/grids/frequencyA/mask",
        "/science/LSAR/GCOV/grids/frequencyA/numberOfLooks",
    ]


def test_harmony_subset_rejects_unbounded_or_invalid_requests(tmp_path: Path) -> None:
    with pytest.raises(NISARAccessError, match="2-degree"):
        request_gcov_subset(
            collection_concept_id="C1234567890-ASF",
            granule_concept_id="G1234567890-ASF",
            bounds=(0.0, 0.0, 3.0, 1.0),
            frequency="frequencyA",
            polarization_term="HHHH",
            output_directory=tmp_path,
            client=FakeHarmony([]),
        )
