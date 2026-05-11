"""
GET  /companies/{company_id}/statement-tab-configs
     — Return saved tab assignment for all statement types as a dict.

POST /companies/{company_id}/statement-tab-configs/{statement_type}
     — Upsert the tab assignment for one statement type.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.services.statement_tab_config_service import get_tab_configs, save_tab_config

router = APIRouter()


@router.get("/companies/{company_id}/statement-tab-configs")
def get_statement_tab_configs(company_id: int, db: Session = Depends(get_db)):
    """Return all saved tab assignments for a company keyed by statement_type."""
    configs = get_tab_configs(company_id, db)
    return {stmt: {"tab": tab} for stmt, tab in configs.items()}


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
    save_tab_config(company_id, statement_type, tab, db)
    return {"success": True}
