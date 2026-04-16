"""
GET  /companies/{company_id}/statement-tab-configs
POST /companies/{company_id}/statement-tab-configs/{statement_type}
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.db.database import get_db

router = APIRouter()


@router.get("/companies/{company_id}/statement-tab-configs")
def get_statement_tab_configs(company_id: int, db: Session = Depends(get_db)):
    rows = db.execute(
        text("SELECT statement_type, config FROM statement_tab_configs WHERE company_id = :cid"),
        {"cid": company_id},
    ).fetchall()

    result = {}
    for row in rows:
        stmt_type = row[0]
        cfg = row[1]
        result[stmt_type] = json.loads(cfg) if isinstance(cfg, str) else cfg

    return result


@router.post("/companies/{company_id}/statement-tab-configs/{statement_type}")
def save_statement_tab_config(
    company_id: int,
    statement_type: str,
    config: dict,
    db: Session = Depends(get_db),
):
    # Verify company exists
    company = db.execute(
        text("SELECT id FROM companies WHERE id = :cid"),
        {"cid": company_id},
    ).fetchone()
    if not company:
        raise HTTPException(status_code=404, detail=f"Company {company_id} not found.")

    config_json = json.dumps(config)

    existing = db.execute(
        text("SELECT id FROM statement_tab_configs WHERE company_id = :cid AND statement_type = :st"),
        {"cid": company_id, "st": statement_type},
    ).fetchone()

    if existing:
        db.execute(
            text(
                "UPDATE statement_tab_configs SET config = :cfg, updated_at = CURRENT_TIMESTAMP "
                "WHERE company_id = :cid AND statement_type = :st"
            ),
            {"cfg": config_json, "cid": company_id, "st": statement_type},
        )
    else:
        db.execute(
            text(
                "INSERT INTO statement_tab_configs (company_id, statement_type, config) "
                "VALUES (:cid, :st, :cfg)"
            ),
            {"cid": company_id, "st": statement_type, "cfg": config_json},
        )

    db.commit()
    return {"success": True}
