"""
DB-backed job store for async Layer 1 extraction jobs.

Jobs are persisted in the extraction_jobs table so they survive container
restarts. Each operation opens and closes its own DB session — safe to call
from background threads.

Also exports extraction_semaphore: a Semaphore(2) that allows up to two
concurrent extractions. IS runs alone first; BS and CFS run concurrently
after IS completes. Semaphore(2) prevents a third simultaneous job while
keeping memory safe.
"""
import json
import logging
import threading
import uuid
from typing import Any, Dict, Optional

from sqlalchemy import text

from app.db.database import SessionLocal

logger = logging.getLogger(__name__)

# One extraction at a time — prevents the 3 concurrent statement-type
# threads from OOM-killing the container.
extraction_semaphore = threading.Semaphore(2)


class JobStore:
    def create_job(self) -> str:
        """Insert a new pending job row and return its job_id."""
        job_id = str(uuid.uuid4())
        db = SessionLocal()
        try:
            db.execute(
                text("INSERT INTO extraction_jobs (job_id, status) VALUES (:id, 'pending')"),
                {"id": job_id},
            )
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
        return job_id

    def set_running(self, job_id: str) -> None:
        self._update(job_id, {"status": "running"})

    def set_done(self, job_id: str, result: Dict[str, Any]) -> None:
        self._update(job_id, {"status": "done", "result": json.dumps(result)})

    def set_error(self, job_id: str, error: str) -> None:
        self._update(job_id, {"status": "error", "error": error})

    def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        db = SessionLocal()
        try:
            row = db.execute(
                text("SELECT status, result, error FROM extraction_jobs WHERE job_id = :id"),
                {"id": job_id},
            ).fetchone()
            if not row:
                return None
            result = json.loads(row[1]) if row[1] else None
            return {"job_id": job_id, "status": row[0], "result": result, "error": row[2]}
        finally:
            db.close()

    def _update(self, job_id: str, fields: Dict[str, Any]) -> None:
        """Generic UPDATE — builds SET clause from the provided fields dict."""
        set_clause = ", ".join(f"{k} = :{k}" for k in fields)
        params = {**fields, "id": job_id}
        db = SessionLocal()
        try:
            db.execute(
                text(f"UPDATE extraction_jobs SET {set_clause} WHERE job_id = :id"),
                params,
            )
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("JobStore: failed to update job %s with %s", job_id, fields)
        finally:
            db.close()


# Module-level singleton imported by route modules.
job_store = JobStore()
