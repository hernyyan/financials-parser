"""
GET  /companies/{company_id}/layer1-templates/{statement_type}  — fetch stored template
POST /companies/{company_id}/layer1-templates/{statement_type}  — upsert template
"""
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.db.database import get_db
from app.models.schemas import Layer1TemplateResponse

logger = logging.getLogger(__name__)

router = APIRouter()

_VALID_TYPES = {"income_statement", "balance_sheet", "cash_flow_statement"}


@router.get("/companies/{company_id}/layer1-templates/{statement_type}", response_model=Layer1TemplateResponse)
def get_layer1_template(
    company_id: int,
    statement_type: str,
    db: Session = Depends(get_db),
):
    if statement_type not in _VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid statement_type: {statement_type}")

    row = db.execute(
        text(
            "SELECT id, company_id, statement_type, template, created_at, updated_at "
            "FROM layer1_templates WHERE company_id = :cid AND statement_type = :st"
        ),
        {"cid": company_id, "st": statement_type},
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="No template found for this company and statement type.")

    template = row[3]
    if isinstance(template, str):
        template = json.loads(template)

    return Layer1TemplateResponse(
        id=row[0],
        company_id=row[1],
        statement_type=row[2],
        template=template,
        created_at=str(row[4]) if row[4] else None,
        updated_at=str(row[5]) if row[5] else None,
    )


@router.post("/companies/{company_id}/layer1-templates/{statement_type}")
def upsert_layer1_template(
    company_id: int,
    statement_type: str,
    payload: dict,
    db: Session = Depends(get_db),
):
    if statement_type not in _VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid statement_type: {statement_type}")

    template_json = json.dumps(payload)

    # Try UPDATE first
    result = db.execute(
        text(
            "UPDATE layer1_templates SET template = :tmpl, updated_at = CURRENT_TIMESTAMP "
            "WHERE company_id = :cid AND statement_type = :st"
        ),
        {"tmpl": template_json, "cid": company_id, "st": statement_type},
    )

    if result.rowcount == 0:
        # No existing row — INSERT
        db.execute(
            text(
                "INSERT INTO layer1_templates (company_id, statement_type, template) "
                "VALUES (:cid, :st, :tmpl)"
            ),
            {"cid": company_id, "st": statement_type, "tmpl": template_json},
        )

    db.commit()
    return {"success": True}
