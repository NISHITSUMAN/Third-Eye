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


def test_nisar_gcov_jobs_are_dispatched_to_nisar_pipeline() -> None:
    admin = FakeAdmin()
    worker = make_worker(admin)
    dispatched: list[str] = []
    worker._process_nisar_job = lambda job: dispatched.append(str(job["id"]))  # type: ignore[method-assign]

    worker.process_job({
        "id": "nisar-job-1",
        "user_id": "user-1",
        "workflow_id": "nisar-gcov-change",
    })

    assert dispatched == ["nisar-job-1"]
    assert admin.updates == []
