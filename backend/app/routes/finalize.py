"""
POST /finalize — Merge corrections with Layer 2 values and save to the DB.
"""
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from app.models.schemas import FinalizeRequest, FinalizeResponse
from app.db.database import get_db
from app.services.template_service import get_template_service
from app.services.finalize_service import get_finalize_service

router = APIRouter()


@router.post("/finalize", response_model=FinalizeResponse)
def finalize_output(request: FinalizeRequest, db: Session = Depends(get_db)):
    """
    Order fields by the canonical template sequence, persist the finalized review,
    and return the final output.
    """
    final_output = get_template_service().assemble_final_output(request.finalValues)

    try:
        finalized_at = get_finalize_service().persist(
            session_id=request.sessionId,
            company_name=request.companyName,
            reporting_period=request.reportingPeriod,
            final_output=final_output,
            corrections=[c.model_dump() for c in request.corrections],
            db=db,
        )
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    return FinalizeResponse(
        success=True,
        sessionId=request.sessionId,
        companyName=request.companyName,
        reportingPeriod=request.reportingPeriod,
        finalizedAt=finalized_at,
        finalOutput=final_output,
        correctionsCount=len(request.corrections),
        flaggedCount=0,
    )
