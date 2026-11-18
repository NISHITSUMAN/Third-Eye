from science_worker.worker import ScienceWorker


class FakeAdmin:
    def __init__(self) -> None:
        self.updates: list[dict[str, object]] = []

    def get_job(self, _: str) -> dict[str, object]:
        return {"cancel_requested_at": None}

    def update_job(self, _: str, values: dict[str, object]) -> None:
        self.updates.append(values)


def make_worker() -> ScienceWorker:
    worker = ScienceWorker.__new__(ScienceWorker)
    worker.admin = FakeAdmin()
    return worker


def test_nisar_aoi_bounds_supports_polygon_and_rejects_large_extent() -> None:
    polygon = {
        "type": "Polygon",
        "coordinates": [[
            [72.8, 18.8], [73.0, 18.8], [73.0, 19.0],
            [72.8, 19.0], [72.8, 18.8],
        ]],
    }
    assert ScienceWorker._aoi_bounds(polygon) == (72.8, 18.8, 73.0, 19.0)

    large = {
        "type": "Polygon",
        "coordinates": [[
            [70, 18], [74, 18], [74, 19], [70, 19], [70, 18],
        ]],
    }
    try:
        ScienceWorker._aoi_bounds(large)
    except Exception as error:
        assert "2 degrees" in str(error)
    else:
        raise AssertionError("Large AOI should be rejected.")


def test_process_job_routes_nisar_workflow_to_nisar_processor(monkeypatch) -> None:
    worker = make_worker()
    called: list[str] = []
    monkeypatch.setattr(worker, "_process_nisar_job", lambda job, job_id, user_id: called.append(job_id))
    worker.process_job({
        "id": "nisar-job",
        "user_id": "user-1",
        "workflow_id": "nisar-gcov-change",
    })
    assert called == ["nisar-job"]
    assert worker.admin.updates[0]["stage"] == "discovering"


def test_guest_nisar_job_uses_isolated_guest_storage_namespace(monkeypatch) -> None:
    worker = make_worker()
    destinations: list[str] = []
    monkeypatch.setattr(
        worker,
        "_process_nisar_job",
        lambda job, job_id, user_id: destinations.append(user_id),
    )
    worker.process_job({
        "id": "guest-job",
        "user_id": None,
        "workflow_id": "nisar-gcov-change",
    })
    assert destinations == ["guest"]
