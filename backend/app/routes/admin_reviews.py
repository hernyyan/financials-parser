"""
Admin endpoints for review management.

GET    /admin/reviews                      — List all reviews with optional filters
GET    /admin/reviews/{session_id}/export  — Download finalized output as CSV attachment
DELETE /admin/reviews/{session_id}         — Delete a review
"""
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.db.database import get_db
from app.services.template_service import get_template_service
from app.utils.json_utils import deserialize_dict, deserialize_list

router = APIRouter(prefix="/admin")


@router.get("/reviews")
def admin_list_reviews(
    status: Optional[str] = Query(default=None, description="Filter by status: 'finalized' or 'in_progress'"),
    company: Optional[str] = Query(default=None, description="Case-insensitive partial match on company name"),
    limit: int = Query(default=50, ge=1),
    db: Session = Depends(get_db),
):
    """List all reviews newest first, with optional status and company filters."""
    conditions: list[str] = []
    params: dict = {}

    if status:
        conditions.append("status = :status")
        params["status"] = status
    if company:
        conditions.append("LOWER(company_name) LIKE :company")
        params["company"] = f"%{company.lower()}%"

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    total: int = db.execute(
        text(f"SELECT COUNT(*) FROM reviews {where_clause}"),
        params,
    ).scalar() or 0

    rows = db.execute(
        text(f"""
            SELECT id, session_id, company_name, reporting_period, status,
                   created_at, finalized_at, corrections
            FROM reviews
            {where_clause}
            ORDER BY created_at DESC
            LIMIT :limit
        """),
        {**params, "limit": limit},
    ).fetchall()

    reviews = []
    for row in rows:
        corrections_list = deserialize_list(row[7])
        corrections_count = len(corrections_list)

        reviews.append({
            "id": row[0],
            "session_id": row[1],
            "company_name": row[2],
            "reporting_period": row[3],
            "status": row[4],
            "created_at": row[5],
            "finalized_at": row[6],
            "corrections_count": corrections_count,
        })

    return {"total": total, "reviews": reviews}


@router.get("/reviews/{session_id}/export")
def admin_export_review(session_id: str, db: Session = Depends(get_db)):
    """Download the finalized output for a review as a CSV file attachment."""
    row = db.execute(
        text("""
            SELECT company_name, reporting_period, final_output, corrections
            FROM reviews WHERE session_id = :sid
        """),
        {"sid": session_id},
    ).fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail=f"Session '{session_id}' not found or not yet finalized.",
        )

    company_name: str = row[0]
    reporting_period: str = row[1]
    final_output: dict = deserialize_dict(row[2])

    csv_content = get_template_service().build_export_csv(final_output)

    safe_company = re.sub(r"[^\w\s-]", "", company_name).strip().replace(" ", "_")
    safe_period = re.sub(r"[^\w\s-]", "", reporting_period).strip().replace(" ", "_")
    filename = f"{safe_company}_{safe_period}.csv"

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/reviews/{session_id}")
def admin_delete_review(session_id: str, db: Session = Depends(get_db)):
    """Delete a review by session_id."""
    row = db.execute(
        text("SELECT id FROM reviews WHERE session_id = :sid"),
        {"sid": session_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Review not found.")

    db.execute(
        text("DELETE FROM reviews WHERE session_id = :sid"),
        {"sid": session_id},
    )
    db.commit()

    return {"success": True, "deleted_session_id": session_id}
