"""
Alert and changelog query logic.

Owns all reads and writes to context_alerts and correction_changelog:

  list_changelog        — paginated correction_changelog entries
  list_alerts           — context_alerts with optional status filter
                          (triggers duplicate scan on every call)
  update_alert_status   — set status on a single alert by id
  list_general_fixes    — read and filter rows from general_fixes.csv
"""
import csv
from io import StringIO
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.services.duplicate_detection_service import scan_duplicate_companies
from app.utils.json_utils import deserialize_list

_VALID_STATUSES = {"open", "resolved", "fixed"}


def list_changelog(
    db: Session,
    company_id: Optional[int] = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Return correction_changelog entries newest-first, optionally filtered by company."""
    rows = db.execute(
        text("""
            SELECT id, timestamp, company_id, company_name, correction_id,
                   field_name, statement_type, layer_a_instruction,
                   layer_a_referenced_fields, layer_b_action, layer_b_detail,
                   markdown_section_affected, source
            FROM correction_changelog
            WHERE (:cid IS NULL OR company_id = :cid)
            ORDER BY id DESC
            LIMIT :limit
        """),
        {"cid": company_id, "limit": limit},
    ).fetchall()

    entries = [
        {
            "id": r[0],
            "timestamp": r[1],
            "company_id": r[2],
            "company_name": r[3],
            "correction_id": r[4],
            "field_name": r[5],
            "statement_type": r[6],
            "layer_a_instruction": r[7],
            "layer_a_referenced_fields": deserialize_list(r[8]),
            "layer_b_action": r[9],
            "layer_b_detail": r[10],
            "markdown_section_affected": r[11],
            "source": r[12],
        }
        for r in rows
    ]
    return {"total_entries": len(entries), "entries": entries}


def list_alerts(
    db: Session,
    status: Optional[str] = "open",
) -> dict[str, Any]:
    """
    Return context_alerts with optional status filter.
    Triggers a duplicate-company scan on every call to surface new pairs.
    Pass status=None or status="all" to return all alerts regardless of status.
    """
    scan_duplicate_companies(db)

    effective_status = None if not status or status == "all" else status
    rows = db.execute(
        text("""
            SELECT id, timestamp, type, company_id, company_name,
                   word_count, message, status
            FROM context_alerts
            WHERE (:status IS NULL OR status = :status)
            ORDER BY id DESC
        """),
        {"status": effective_status},
    ).fetchall()

    alerts = [
        {
            "id": r[0],
            "_file_index": r[0],  # backward compat — frontend uses _file_index as update key
            "timestamp": r[1],
            "type": r[2],
            "company_id": r[3],
            "company_name": r[4],
            "word_count": r[5],
            "message": r[6],
            "status": r[7],
        }
        for r in rows
    ]
    return {"total_alerts": len(alerts), "alerts": alerts}


def update_alert_status(index: int, new_status: str, db: Session) -> dict[str, Any]:
    """
    Set the status of a context_alert by its DB id.
    Raises HTTPException 422 for invalid statuses, 404 if not found. Commits on success.
    """
    if new_status not in _VALID_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"Status must be one of: {_VALID_STATUSES}",
        )

    result = db.execute(
        text("UPDATE context_alerts SET status = :status WHERE id = :id"),
        {"status": new_status, "id": index},
    )
    db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Alert not found.")

    return {"success": True, "index": index, "new_status": new_status}


def list_general_fixes(
    path: Path,
    limit: int = 50,
    company: Optional[str] = None,
) -> dict[str, Any]:
    """
    Read rows from the general_fixes.csv, filter by company substring, and
    return newest-first (the CSV is append-only, so reverse = newest first).
    """
    if not path.exists():
        return {"total_entries": 0, "entries": []}

    try:
        text_content = path.read_text(encoding="utf-8")
    except OSError:
        return {"total_entries": 0, "entries": []}

    rows: list[dict] = []
    reader = csv.DictReader(StringIO(text_content))
    for row in reader:
        try:
            rows.append(dict(row))
        except Exception:
            continue

    if company:
        company_lower = company.lower()
        rows = [r for r in rows if company_lower in (r.get("company") or "").lower()]

    rows.reverse()
    return {"total_entries": len(rows[:limit]), "entries": rows[:limit]}
