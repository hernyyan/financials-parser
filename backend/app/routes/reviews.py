"""
GET /reviews/check-existing   — Check if finalized data exists for a company+period.
POST /reviews/continue-previous — Create a new session pre-populated from the latest finalized review.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.db.database import get_db
from app.models.schemas import ContinuePreviousRequest
from app.services.company_service import get_company_or_404
from app.utils.json_utils import deserialize_dict, deserialize_list

router = APIRouter()


@router.get("/reviews/check-existing")
def check_existing_review(
    company_id: int = Query(...),
    reporting_period: str = Query(...),
    db: Session = Depends(get_db),
):
    """Check if finalized data exists for this company+period."""
    _, company_name, _ = get_company_or_404(company_id, db)

    row = db.execute(
        text("""
            SELECT session_id, finalized_at
            FROM reviews
            WHERE company_name = :name
              AND reporting_period = :period
              AND final_output IS NOT NULL
            ORDER BY finalized_at DESC
            LIMIT 1
        """),
        {"name": company_name, "period": reporting_period},
    ).fetchone()

    if row:
        return {
            "exists": True,
            "session_id": row[0],
            "finalized_at": str(row[1]) if row[1] else None,
        }
    return {"exists": False}


@router.post("/reviews/continue-previous")
def continue_previous_review(
    request: ContinuePreviousRequest,
    db: Session = Depends(get_db),
):
    """Create a new review session pre-populated with the latest finalized data."""
    _, company_name, _ = get_company_or_404(request.company_id, db)

    source = db.execute(
        text("""
            SELECT session_id, layer1_data, layer2_data, corrections
            FROM reviews
            WHERE company_name = :name
              AND reporting_period = :period
              AND final_output IS NOT NULL
            ORDER BY finalized_at DESC
            LIMIT 1
        """),
        {"name": company_name, "period": request.reporting_period},
    ).fetchone()

    if not source:
        raise HTTPException(status_code=404, detail="No finalized review found for this period.")

    new_session_id = str(uuid.uuid4())

    db.execute(
        text("""
            INSERT INTO reviews (session_id, company_name, reporting_period, status,
                                 layer1_data, layer2_data, corrections)
            VALUES (:sid, :name, :period, 'in_progress',
                    :l1, :l2, :corrections)
        """),
        {
            "sid": new_session_id,
            "name": company_name,
            "period": request.reporting_period,
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
        "layer1_data": deserialize_dict(source[1]),
        "layer2_data": deserialize_dict(source[2]),
        "corrections": deserialize_list(source[3]),
    }
