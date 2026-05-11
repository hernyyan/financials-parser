"""
GET /companies               — List all companies ordered alphabetically.
POST /companies              — Create a new company.
POST /companies/{id}/reprocess-corrections
                             — Developer tool: resets and reruns the AI pipeline for a company.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.schemas import CompanyCreate, CompanyResponse, ReprocessResponse, ReprocessCorrectionResult
from app.services.company_service import create_company as _create_company, get_company_or_404, list_companies as _list_companies
from app.utils.text_utils import markdown_body_word_count, count_context_rules

router = APIRouter()


@router.get("/companies", response_model=list[CompanyResponse])
def list_companies(db: Session = Depends(get_db)):
    """Return all companies ordered alphabetically by name."""
    return [CompanyResponse(id=cid, name=name) for cid, name in _list_companies(db)]


@router.post("/companies", response_model=CompanyResponse, status_code=201)
def create_company(request: CompanyCreate, db: Session = Depends(get_db)):
    """Create a new company record."""
    new_id, name = _create_company(request.name, db)
    return CompanyResponse(id=new_id, name=name)


@router.get("/companies/{company_id}/context-status")
def get_context_status(company_id: int, db: Session = Depends(get_db)):
    """Check if a company has a context with actual rules."""
    _, company_name, context = get_company_or_404(company_id, db)
    rule_count = count_context_rules(context)
    has_rules = rule_count > 0
    wc = markdown_body_word_count(context) if has_rules else 0

    return {
        "company_id": company_id,
        "company_name": company_name,
        "has_rules": has_rules,
        "rule_count": rule_count,
        "word_count": wc,
    }


@router.post("/companies/{company_id}/reprocess-corrections", response_model=ReprocessResponse)
def reprocess_corrections(company_id: int, db: Session = Depends(get_db)):
    """
    Developer endpoint: resets the company's context and changelog entries,
    then reruns the Layer A → Layer B pipeline for all company_specific corrections.
    """
    _, company_name, _ = get_company_or_404(company_id, db)

    from app.services.company_context_service import reset_company_for_reprocessing, process_pending_corrections
    reset_company_for_reprocessing(company_id, company_name, db)
    db.commit()

    raw_results = process_pending_corrections(company_id, db)

    results = [
        ReprocessCorrectionResult(
            correction_id=r.get("correction_id", 0),
            action=r.get("action", "UNKNOWN"),
            detail=r.get("detail", ""),
            layer_a_instruction=r.get("layer_a_instruction"),
        )
        for r in raw_results
    ]

    return ReprocessResponse(
        company_id=company_id,
        company_name=company_name,
        corrections_reprocessed=len(results),
        results=results,
    )
