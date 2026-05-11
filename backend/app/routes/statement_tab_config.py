"""
GET  /companies/{company_id}/statement-tab-configs
     — Return saved tab assignment for all statement types as a dict.

POST /companies/{company_id}/statement-tab-configs/{statement_type}
     — Upsert the tab assignment for one statement type.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.db.database import get_db

router = APIRouter()


@router.get("/companies/{company_id}/statement-tab-configs")
def get_statement_tab_configs(company_id: int, db: Session = Depends(get_db)):
    """Return all saved tab assignments for a company keyed by statement_type."""
    rows = db.execute(
        text("SELECT statement_type, tab FROM statement_tab_configs WHERE company_id = :cid"),
        {"cid": company_id},
    ).fetchall()
    return {row[0]: {"tab": row[1]} for row in rows}


@router.post("/companies/{company_id}/statement-tab-configs/{statement_type}")
def save_statement_tab_config(
    company_id: int,
    statement_type: str,
    payload: dict,
    db: Session = Depends(get_db),
):
    """Upsert the tab assignment for a single statement type."""
    tab = payload.get("tab", "")
    if not tab:
        return {"success": False, "detail": "tab is required"}

    updated = db.execute(
        text("""
            UPDATE statement_tab_configs
            SET tab = :tab, updated_at = CURRENT_TIMESTAMP
            WHERE company_id = :cid AND statement_type = :stmt
        """),
        {"tab": tab, "cid": company_id, "stmt": statement_type},
    ).rowcount

    if updated == 0:
        db.execute(
            text("""
                INSERT INTO statement_tab_configs (company_id, statement_type, tab)
                VALUES (:cid, :stmt, :tab)
            """),
            {"cid": company_id, "stmt": statement_type, "tab": tab},
        )

    db.commit()
    return {"success": True}
