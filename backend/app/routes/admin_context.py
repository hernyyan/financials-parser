"""
Admin endpoints for company context management.

GET  /admin/company-context/{company_id} — Full context contents from DB
PUT  /admin/company-context/{company_id} — Overwrite the context in DB
POST /admin/write-rule                   — Submit a rule through Layer A → Layer B pipeline
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.transaction import db_transaction
from app.models.schemas import AdminContextUpdateRequest, AdminWriteRuleRequest
from app.services.company_context_service import write_rule
from app.services.company_service import get_company_or_404, update_company_context
from app.utils.text_utils import markdown_body_word_count

router = APIRouter(prefix="/admin")


@router.get("/company-context/{company_id}")
def admin_company_context(company_id: int, db: Session = Depends(get_db)):
    """Return the full contents of a company's context from DB."""
    _, name, content = get_company_or_404(company_id, db)
    word_count = markdown_body_word_count(content) if content.strip() else 0
    return {"id": company_id, "name": name, "word_count": word_count, "content": content}


@router.put("/company-context/{company_id}")
def admin_update_company_context(
    company_id: int,
    request: AdminContextUpdateRequest,
    db: Session = Depends(get_db),
):
    """Directly overwrite the company's context in DB."""
    get_company_or_404(company_id, db)
    with db_transaction(db, "Failed to update context"):
        word_count = update_company_context(company_id, request.content, db)
    return {"success": True, "word_count": word_count}


@router.post("/write-rule")
def admin_write_rule(
    request: AdminWriteRuleRequest,
    db: Session = Depends(get_db),
):
    """Submit a rule through Layer A → Layer B pipeline."""
    company_id, company_name, current_context = get_company_or_404(request.company_id, db)
    with db_transaction(db, "Failed to write rule"):
        result = write_rule(
            company_id=company_id,
            company_name=company_name,
            current_context=current_context,
            field_name=request.field_name,
            statement_type=request.statement_type,
            rule_text=request.rule_text,
            db=db,
        )
    return result
