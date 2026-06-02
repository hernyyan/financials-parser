"""
In-memory job store for async Layer 1 extraction jobs.

Each job is keyed by a UUID and transitions through:
  pending → running → done | error

A background daemon thread purges jobs older than JOB_TTL_SECONDS to prevent
memory growth over time.

Design note: This is an in-memory singleton appropriate for a single-replica
Azure Container App. If the app ever scales to multiple replicas, replace with
a Redis or database-backed store.
"""
import logging
import threading
import time
import uuid
from typing import Any, Dict, Literal, Optional

logger = logging.getLogger(__name__)

JOB_TTL_SECONDS = 600   # 10 minutes — beyond worst-case extraction time
CLEANUP_INTERVAL = 120  # purge sweep every 2 minutes

JobStatus = Literal["pending", "running", "done", "error"]


class Job:
    __slots__ = ("job_id", "status", "result", "error", "created_at")

    def __init__(self, job_id: str) -> None:
        self.job_id: str = job_id
        self.status: JobStatus = "pending"
        self.result: Optional[Dict[str, Any]] = None
        self.error: Optional[str] = None
        self.created_at: float = time.monotonic()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "job_id": self.job_id,
            "status": self.status,
            "result": self.result,
            "error": self.error,
        }


class JobStore:
    def __init__(self) -> None:
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()
        self._start_cleanup_daemon()

    def create_job(self) -> str:
        """Create a new pending job and return its job_id."""
        job_id = str(uuid.uuid4())
        with self._lock:
            self._jobs[job_id] = Job(job_id)
        return job_id

    def set_running(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = "running"

    def set_done(self, job_id: str, result: Dict[str, Any]) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = "done"
                job.result = result

    def set_error(self, job_id: str, error: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = "error"
                job.error = error

    def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Return job state dict, or None if not found / already purged."""
        with self._lock:
            job = self._jobs.get(job_id)
            return job.to_dict() if job else None

    def _purge_expired(self) -> None:
        cutoff = time.monotonic() - JOB_TTL_SECONDS
        with self._lock:
            expired = [k for k, v in self._jobs.items() if v.created_at < cutoff]
            for k in expired:
                del self._jobs[k]
        if expired:
            logger.debug("JobStore: purged %d expired jobs", len(expired))

    def _start_cleanup_daemon(self) -> None:
        def _loop() -> None:
            while True:
                time.sleep(CLEANUP_INTERVAL)
                try:
                    self._purge_expired()
                except Exception:
                    logger.exception("JobStore cleanup error")

        threading.Thread(
            target=_loop,
            daemon=True,
            name="job-store-cleanup",
        ).start()


# Module-level singleton — imported directly by route modules.
job_store = JobStore()
