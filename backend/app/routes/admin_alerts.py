"""
Admin endpoints for alerts, changelog, and general fixes.

GET /admin/changelog           — Entries from correction_changelog table
GET /admin/alerts              — Entries from context_alerts table (with duplicate scan)
PUT /admin/alerts/update-status— Update alert status by DB id
GET /admin/general-fixes       — Rows from general_fixes.csv
"""
import csv
from io import StringIO
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.db.database import get_db
from app.models.schemas import AlertStatusUpdateRequest
from app.routes.admin_utils import GENERAL_FIXES_PATH, read_jsonl
from app.services.duplicate_detection_service import scan_duplicate_companies
from app.utils.json_utils import deserialize_list

router = APIRouter(prefix="/admin")


@router.get("/changelog")
def admin_changelog(
    company_id: Optional[int] = Query(default=None),
    limit: int = Query(default=50, ge=1),
    db: Session = Depends(get_db),
):
    """Return entries from correction_changelog table, newest first."""
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

    entries = []
    for r in rows:
        entry = {
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
        entries.append(entry)

    return {"total_entries": len(entries), "entries": entries}


@router.get("/alerts")
def admin_alerts(
    status_filter: Optional[str] = Query(default="open", alias="status"),
    db: Session = Depends(get_db),
):
    """Return all alerts. Runs duplicate company scan on each call to detect new duplicates."""
    scan_duplicate_companies(db)

    status = None if not status_filter or status_filter == "all" else status_filter
    rows = db.execute(
        text("""
            SELECT id, timestamp, type, company_id, company_name,
                   word_count, message, status
            FROM context_alerts
            WHERE (:status IS NULL OR status = :status)
            ORDER BY id DESC
        """),
        {"status": status},
    ).fetchall()

    alerts = []
    for r in rows:
        alerts.append({
            "id": r[0],
            "_file_index": r[0],  # backward compat — frontend uses _file_index as the update key
            "timestamp": r[1],
            "type": r[2],
            "company_id": r[3],
            "company_name": r[4],
            "word_count": r[5],
            "message": r[6],
            "status": r[7],
        })

    return {"total_alerts": len(alerts), "alerts": alerts}


@router.put("/alerts/update-status")
def admin_update_alert_status(
    request: AlertStatusUpdateRequest,
    db: Session = Depends(get_db),
):
    """Update the status of an alert by its DB id (sent as 'index' for backward compat)."""
    valid_statuses = {"open", "resolved", "fixed"}
    if request.new_status not in valid_statuses:
        raise HTTPException(status_code=422, detail=f"Status must be one of: {valid_statuses}")

    result = db.execute(
        text("UPDATE context_alerts SET status = :status WHERE id = :id"),
        {"status": request.new_status, "id": request.index},
    )
    db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Alert not found.")

    return {"success": True, "index": request.index, "new_status": request.new_status}


@router.get("/general-fixes")
def admin_general_fixes(
    limit: int = Query(default=50, ge=1),
    company: Optional[str] = Query(default=None),
):
    """Return rows from general_fixes.csv, newest first."""
    if not GENERAL_FIXES_PATH.exists():
        return {"total_entries": 0, "entries": []}

    try:
        text_content = GENERAL_FIXES_PATH.read_text(encoding="utf-8")
    except OSError:
        return {"total_entries": 0, "entries": []}

    rows = []
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
    rows = rows[:limit]

    return {"total_entries": len(rows), "entries": rows}


