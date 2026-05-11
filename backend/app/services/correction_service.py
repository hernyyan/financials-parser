"""
CorrectionService — owns single-correction persistence.

Responsibilities:
  - Timestamp generation (always UTC ISO-8601)
  - Correction record construction
  - DB upsert (does NOT commit — caller owns the transaction boundary)

The batch-processing path (process_corrections) lives in correction_router.py
and is not duplicated here — that path handles multi-tag routing logic.
"""
from datetime import datetime, timezone
from typing import Any

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
    Build and upsert a single analyst correction. Does NOT commit.

    Returns (correction_id, timestamp_iso). If session_id is None the
    upsert is skipped (correction_id defaults to 1 for response compatibility).
    Caller is responsible for commit/rollback.
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
        correction_id = upsert_correction(db, session_id, correction_record)

    return correction_id, timestamp
