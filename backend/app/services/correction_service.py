"""
CorrectionService — owns single-correction persistence.

Responsibilities:
  - Timestamp generation (always UTC ISO-8601)
  - Correction record construction
  - DB upsert + transaction (commit/rollback)

The batch-processing path (process_corrections) lives in correction_router.py
and is not duplicated here — that path handles multi-tag routing logic.
"""
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.db.review_store import upsert_correction


def save_correction(
    session_id: str | None,
    field_name: str,
    statement_type: str,
    original_value: Any,
    corrected_value: Any,
    reasoning: str | None,
    tag: str | None,
    db: Session,
) -> tuple[int, str]:
    """
    Persist a single analyst correction.

    Builds the correction record, upserts it into the session's corrections
    list, and commits. Returns (correction_id, timestamp_iso).

    If session_id is None the correction is not persisted (no-op path) —
    correction_id defaults to 1 for response compatibility.
    """
    timestamp = datetime.now(timezone.utc).isoformat()
    correction_record = {
        "fieldName": field_name,
        "statementType": statement_type,
        "originalValue": original_value,
        "correctedValue": corrected_value,
        "reasoning": reasoning,
        "tag": tag,
        "timestamp": timestamp,
    }

    correction_id = 1
    if session_id:
        try:
            correction_id = upsert_correction(db, session_id, correction_record)
            db.commit()
        except HTTPException:
            raise
        except Exception:
            db.rollback()

    return correction_id, timestamp
