"""
POST /corrections         — Save an analyst correction for a single template field.
POST /corrections/process — Batch-route corrections by tag (general_fix → CSV, company_specific → queue).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.transaction import db_transaction
from app.models.schemas import (
    CorrectionRequest,
    CorrectionResponse,
    CorrectionProcessRequest,
    CorrectionProcessResponse,
)
from app.services.correction_service import save_correction as _save_correction
from app.services.correction_router import process_corrections as _process_corrections

router = APIRouter()


@router.post("/corrections", response_model=CorrectionResponse)
def save_correction(request: CorrectionRequest, db: Session = Depends(get_db)):
    """
    Persist a single analyst correction.
    If a correction for the same fieldName already exists in the session,
    it is replaced (not duplicated).
    """
    if not request.fieldName or not request.fieldName.strip():
        raise HTTPException(status_code=400, detail="fieldName is required.")

    with db_transaction(db, "Failed to save correction"):
        correction_id, timestamp = _save_correction(
            session_id=request.sessionId,
            field_name=request.fieldName,
            statement_type=request.statementType,
            original_value=request.originalValue,
            corrected_value=request.correctedValue,
            reasoning=request.reasoning,
            tag=request.tag,
            db=db,
        )

    return CorrectionResponse(
        success=True,
        correctionId=correction_id,
        timestamp=timestamp,
        message=f"Correction for '{request.fieldName}' saved.",
    )


@router.post("/corrections/process", response_model=CorrectionProcessResponse)
def process_corrections_batch(
    request: CorrectionProcessRequest,
    db: Session = Depends(get_db),
):
    """
    Batch-process corrections by tag:
      - one_off_error    → no side effects
      - general_fix      → append row to backend/data/general_fixes.csv
      - company_specific → queue in company_specific_corrections table
    """
    return _process_corrections(
        db=db,
        company_id=request.company_id,
        company_name=request.company_name,
        period=request.period,
        corrections=request.corrections,
    )
