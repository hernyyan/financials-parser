"""
Admin endpoints for alerts, changelog, and general fixes.

GET /admin/changelog           — Entries from correction_changelog table
GET /admin/alerts              — Entries from context_alerts table (with duplicate scan)
PUT /admin/alerts/update-status— Update alert status by DB id
GET /admin/general-fixes       — Rows from general_fixes.csv
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.transaction import db_transaction
from app.models.schemas import AlertStatusUpdateRequest
from app.routes.admin_utils import GENERAL_FIXES_PATH
from app.services.alert_service import (
    list_alerts,
    list_changelog,
    list_general_fixes,
    update_alert_status,
)

router = APIRouter(prefix="/admin")


@router.get("/changelog")
def admin_changelog(
    company_id: Optional[int] = Query(default=None),
    limit: int = Query(default=50, ge=1),
    db: Session = Depends(get_db),
):
    """Return entries from correction_changelog table, newest first."""
    return list_changelog(db, company_id=company_id, limit=limit)


@router.get("/alerts")
def admin_alerts(
    status_filter: Optional[str] = Query(default="open", alias="status"),
    db: Session = Depends(get_db),
):
    """Return all alerts. Runs duplicate company scan on each call to detect new duplicates."""
    result = list_alerts(db, status=status_filter)
    db.commit()  # commit any alert rows inserted by the duplicate scan
    return result


@router.put("/alerts/update-status")
def admin_update_alert_status(
    request: AlertStatusUpdateRequest,
    db: Session = Depends(get_db),
):
    """Update the status of an alert by its DB id (sent as 'index' for backward compat)."""
    with db_transaction(db, "Failed to update alert"):
        result = update_alert_status(request.index, request.new_status, db)
    return result


@router.get("/general-fixes")
def admin_general_fixes(
    limit: int = Query(default=50, ge=1),
    company: Optional[str] = Query(default=None),
):
    """Return rows from general_fixes.csv, newest first."""
    return list_general_fixes(GENERAL_FIXES_PATH, limit=limit, company=company)
