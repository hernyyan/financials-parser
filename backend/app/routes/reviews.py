"""
GET /reviews/check-existing   — Check if finalized data exists for a company+period.
POST /reviews/continue-previous — Create a new session pre-populated from the latest finalized review.
"""
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.db.database import get_db
from app.models.schemas import ContinuePreviousRequest

router = APIRouter()


@router.get("/reviews/check-existing")
def check_existing_review(
    company_id: int = Query(...),
    reporting_period: str = Query(...),
    db: Session = Depends(get_db),
):
    """Check if a finalized review exists for this company_id + reporting_period."""
    row = db.execute(
        text("""
            SELECT session_id, finalized_at
            FROM reviews
            WHERE company_id = :cid
              AND reporting_period = :period
              AND final_output IS NOT NULL
            ORDER BY finalized_at DESC
            LIMIT 1
        """),
        {"cid": company_id, "period": reporting_period},
    ).fetchone()

    if row:
        return {
            "exists": True,
            "session_id": row[0],
            "finalized_at": str(row[1]) if row[1] else None,
        }
    return {"exists": False}


@router.get("/reviews/{session_id}/data")
def get_review_data(session_id: str, db: Session = Depends(get_db)):
    """Return layer1/layer2 data for a review session (read-only preview, no new row created)."""
    row = db.execute(
        text("""
            SELECT layer1_data, layer2_data, company_name, reporting_period
            FROM reviews WHERE session_id = :sid
        """),
        {"sid": session_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Review not found.")
    return {
        "layer1_data": json.loads(row[0]) if isinstance(row[0], str) else (row[0] or {}),
        "layer2_data": json.loads(row[1]) if isinstance(row[1], str) else (row[1] or {}),
        "company_name": row[2],
        "reporting_period": row[3],
    }


@router.post("/reviews/continue-previous")
def continue_previous_review(
    request: ContinuePreviousRequest,
    db: Session = Depends(get_db),
):
    """Create a new in-progress session pre-populated with the latest finalized data."""
    company = db.execute(
        text("SELECT name FROM companies WHERE id = :id"),
        {"id": request.company_id},
    ).fetchone()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")

    source = db.execute(
        text("""
            SELECT session_id, layer1_data, layer2_data, corrections
            FROM reviews
            WHERE company_id = :cid
              AND reporting_period = :period
              AND final_output IS NOT NULL
            ORDER BY finalized_at DESC
            LIMIT 1
        """),
        {"cid": request.company_id, "period": request.reporting_period},
    ).fetchone()

    if not source:
        raise HTTPException(status_code=404, detail="No finalized review found for this period.")

    new_session_id = str(uuid.uuid4())

    db.execute(
        text("""
            INSERT INTO reviews
                (session_id, company_name, reporting_period, status, company_id,
                 layer1_data, layer2_data, corrections)
            VALUES
                (:sid, :name, :period, 'in_progress', :cid,
                 :l1, :l2, :corrections)
        """),
        {
            "sid": new_session_id,
            "name": company[0],
            "period": request.reporting_period,
            "cid": request.company_id,
            "l1": source[1],
            "l2": source[2],
            "corrections": source[3],
        },
    )
    db.commit()

    return {
        "session_id": new_session_id,
        "company_name": company[0],
        "reporting_period": request.reporting_period,
        "layer1_data": json.loads(source[1]) if isinstance(source[1], str) else source[1],
        "layer2_data": json.loads(source[2]) if isinstance(source[2], str) else source[2],
        "corrections": json.loads(source[3]) if isinstance(source[3], str) else (source[3] or []),
    }
