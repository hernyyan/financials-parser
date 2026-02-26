"""
POST /finalize — Merge corrections with Layer 2 values and save to SQLite.
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.schemas import FinalizeRequest, FinalizeResponse
from app.db.database import get_db
from app.services.template_service import get_template_service

router = APIRouter()


@router.post("/finalize", response_model=FinalizeResponse)
async def finalize_output(request: FinalizeRequest, db: Session = Depends(get_db)):
    """
    Merge the Layer 2 classified values with any analyst corrections, order by
    template field sequence, persist to SQLite, and return the final output.
    """
    now = datetime.now(timezone.utc).isoformat()

    # Order output fields by the canonical template sequence
    template_svc = get_template_service()
    is_fields = template_svc.get_field_order("income_statement")
    bs_fields = template_svc.get_field_order("balance_sheet")

    is_raw = request.finalValues.get("income_statement", {})
    bs_raw = request.finalValues.get("balance_sheet", {})

    final_output = {
        "Income Statement": {f: is_raw.get(f) for f in is_fields if f in is_raw},
        "Balance Sheet": {f: bs_raw.get(f) for f in bs_fields if f in bs_raw},
    }

    corrections_json = json.dumps([c.model_dump() for c in request.corrections])
    final_output_json = json.dumps(final_output)

    try:
        if request.sessionId:
            result = db.execute(
                text("""
                    UPDATE reviews
                    SET status       = 'finalized',
                        finalized_at = :finalized_at,
                        company_name = :company_name,
                        reporting_period = :reporting_period,
                        final_output = :final_output,
                        corrections  = :corrections
                    WHERE session_id = :session_id
                """),
                {
                    "session_id": request.sessionId,
                    "company_name": request.companyName,
                    "reporting_period": request.reportingPeriod,
                    "finalized_at": now,
                    "final_output": final_output_json,
                    "corrections": corrections_json,
                },
            )
            if result.rowcount == 0:
                # No existing record — insert a new one
                db.execute(
                    text("""
                        INSERT INTO reviews
                            (session_id, company_name, reporting_period, status,
                             finalized_at, final_output, corrections)
                        VALUES
                            (:session_id, :company_name, :reporting_period, 'finalized',
                             :finalized_at, :final_output, :corrections)
                    """),
                    {
                        "session_id": request.sessionId,
                        "company_name": request.companyName,
                        "reporting_period": request.reportingPeriod,
                        "finalized_at": now,
                        "final_output": final_output_json,
                        "corrections": corrections_json,
                    },
                )
        else:
            db.execute(
                text("""
                    INSERT INTO reviews
                        (company_name, reporting_period, status,
                         finalized_at, final_output, corrections)
                    VALUES
                        (:company_name, :reporting_period, 'finalized',
                         :finalized_at, :final_output, :corrections)
                """),
                {
                    "company_name": request.companyName,
                    "reporting_period": request.reportingPeriod,
                    "finalized_at": now,
                    "final_output": final_output_json,
                    "corrections": corrections_json,
                },
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
        finalizedAt=now,
        finalOutput=final_output,
        correctionsCount=len(request.corrections),
        flaggedCount=0,
    )
