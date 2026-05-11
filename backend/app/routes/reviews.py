"""
GET  /reviews/check-existing      — Check if finalized data exists for a company+period.
POST /reviews/continue-previous   — Create a new session pre-populated from the latest finalized review.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.schemas import ContinuePreviousRequest
from app.services.company_service import get_company_or_404
from app.services.review_service import check_existing_finalized, continue_from_previous

router = APIRouter()


@router.get("/reviews/check-existing")
def check_existing_review(
    company_id: int = Query(...),
    reporting_period: str = Query(...),
    db: Session = Depends(get_db),
):
    """Check if finalized data exists for this company+period."""
    _, company_name, _ = get_company_or_404(company_id, db)
    return check_existing_finalized(company_name, reporting_period, db)


@router.post("/reviews/continue-previous")
def continue_previous_review(
    request: ContinuePreviousRequest,
    db: Session = Depends(get_db),
):
    """Create a new review session pre-populated with the latest finalized data."""
    _, company_name, _ = get_company_or_404(request.company_id, db)
    return continue_from_previous(company_name, request.reporting_period, db)
