"""
POST /corrections         — Save an analyst correction for a single template field.
POST /corrections/process — Batch-route corrections by tag (general_fix → CSV, company_specific → queue).
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.db.database import get_db
from app.models.schemas import (
    CorrectionRequest,
    CorrectionResponse,
    CorrectionProcessRequest,
    CorrectionProcessResponse,
)
from app.services.correction_router import process_corrections as _process_corrections

router = APIRouter()


@router.post("/corrections", response_model=CorrectionResponse)
async def save_correction(request: CorrectionRequest, db: Session = Depends(get_db)):
    """
    Persist a single analyst correction.
    If a correction for the same fieldName already exists in the session,
    it is replaced (not duplicated).
    """
    if not request.fieldName or not request.fieldName.strip():
        raise HTTPException(status_code=400, detail="fieldName is required.")

    timestamp = datetime.now(timezone.utc).isoformat()

    correction_record = {
        "fieldName": request.fieldName,
        "statementType": request.statementType,
        "originalValue": request.originalValue,
        "correctedValue": request.correctedValue,
        "reasoning": request.reasoning,
        "tag": request.tag,
        "timestamp": timestamp,
    }

    correction_id = 1

    if request.sessionId:
        try:
            row = db.execute(
                text("SELECT corrections FROM reviews WHERE session_id = :sid"),
                {"sid": request.sessionId},
            ).fetchone()

            existing: list = json.loads(row[0]) if row and row[0] else []
            if not isinstance(existing, list):
                existing = []

            # Replace existing correction for the same field, or append
            found = False
            for i, c in enumerate(existing):
                if c.get("fieldName") == request.fieldName:
                    existing[i] = correction_record
                    correction_id = i + 1
                    found = True
                    break

            if not found:
                existing.append(correction_record)
                correction_id = len(existing)

            db.execute(
                text("UPDATE reviews SET corrections = :data WHERE session_id = :sid"),
                {"data": json.dumps(existing), "sid": request.sessionId},
            )
            db.commit()
        except HTTPException:
            raise
        except Exception:
            db.rollback()

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
