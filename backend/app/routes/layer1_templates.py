"""
GET  /companies/{company_id}/layer1-templates/{statement_type}  — fetch stored template
POST /companies/{company_id}/layer1-templates/{statement_type}  — upsert template
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.schemas import Layer1TemplateResponse
from app.services.layer1_service import get_layer1_service
from app.utils.statement_meta import validate_statement_type

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/companies/{company_id}/layer1-templates/{statement_type}", response_model=Layer1TemplateResponse)
def get_layer1_template(
    company_id: int,
    statement_type: str,
    db: Session = Depends(get_db),
):
    try:
        statement_type = validate_statement_type(statement_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    row = get_layer1_service().get_template(company_id, statement_type, db)
    if not row:
        raise HTTPException(status_code=404, detail="No template found for this company and statement type.")

    return Layer1TemplateResponse(
        id=row["id"],
        company_id=row["company_id"],
        statement_type=row["statement_type"],
        template=row["template"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.post("/companies/{company_id}/layer1-templates/{statement_type}")
def upsert_layer1_template(
    company_id: int,
    statement_type: str,
    payload: dict,
    db: Session = Depends(get_db),
):
    try:
        statement_type = validate_statement_type(statement_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    get_layer1_service().save_template(company_id, statement_type, payload, db)
    return {"success": True}
