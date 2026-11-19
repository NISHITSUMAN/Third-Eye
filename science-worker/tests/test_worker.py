from science_worker.processor import ProcessingError
from science_worker.worker import ScienceWorker


class FakeAdmin:
    def __init__(self, *, cancelled: bool = False) -> None:
        self.cancelled = cancelled
        self.updates: list[dict[str, object]] = []

    def get_job(self, _: str) -> dict[str, object]:
        return {"cancel_requested_at": "requested" if self.cancelled else None}

    def update_job(self, _: str, values: dict[str, object]) -> None:
        self.updates.append(values)


def make_worker(admin: FakeAdmin) -> ScienceWorker:
    worker = ScienceWorker.__new__(ScienceWorker)
    worker.admin = admin
    return worker


def test_cancel_requested_during_failure_is_not_reported_as_failed() -> None:
    admin = FakeAdmin(cancelled=True)
    worker = make_worker(admin)

    worker._handle_failure(
        {"id": "job-1", "attempts": 1},
        ProcessingError("Source request failed.", retryable=True),
    )

    assert admin.updates[-1]["status"] == "cancelled"
    assert admin.updates[-1]["stage"] == "cancelled"


def test_retryable_failure_resets_progress_before_requeue() -> None:
    admin = FakeAdmin()
    worker = make_worker(admin)

    worker._handle_failure(
        {"id": "job-1", "attempts": 1},
        ProcessingError("Source request failed.", retryable=True),
    )

    assert admin.updates[-1]["status"] == "queued"
    assert admin.updates[-1]["progress"] == 0



class FakeHTTPResponse:
    def __init__(self, status_code: int, payload=None) -> None:
        self.status_code = status_code
        self._payload = payload
        self.is_success = 200 <= status_code < 300
        self.text = ""

    def json(self):
        return self._payload


class FakeCleanupClient:
    def __init__(self) -> None:
        self.deleted: list[str] = []

    def get(self, *_args, **_kwargs):
        return FakeHTTPResponse(200, [{"id": "123e4567-e89b-12d3-a456-426614174000", "result": None}])

    def delete(self, url, **_kwargs):
        self.deleted.append(url)
        return FakeHTTPResponse(204)


def test_guest_cleanup_removes_partial_outputs_without_completed_result() -> None:
    worker = ScienceWorker.__new__(ScienceWorker)
    worker.client = FakeCleanupClient()
    worker.base_url = "https://supabase.example"

    worker.cleanup_expired_guest_jobs()

    output_deletes = [url for url in worker.client.deleted if "/storage/v1/object/" in url]
    assert len(output_deletes) == 4
    assert any("nisar-gcov-uncertainty.tif" in url for url in output_deletes)
    assert any("/rest/v1/scientific_jobs" in url for url in worker.client.deleted)
