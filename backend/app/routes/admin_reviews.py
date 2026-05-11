"""
Admin endpoints for review management.

GET    /admin/reviews                      — List all reviews with optional filters
GET    /admin/reviews/{session_id}/export  — Download finalized output as CSV attachment
DELETE /admin/reviews/{session_id}         — Delete a review
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.transaction import db_transaction
from app.services.review_service import delete_review, export_review, list_reviews

router = APIRouter(prefix="/admin")


@router.get("/reviews")
def admin_list_reviews(
    status: Optional[str] = Query(default=None),
    company: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1),
    db: Session = Depends(get_db),
):
    """List all reviews newest first, with optional status and company filters."""
    return list_reviews(db, status=status, company=company, limit=limit)


@router.get("/reviews/{session_id}/export")
def admin_export_review(session_id: str, db: Session = Depends(get_db)):
    """Download the finalized output for a review as a CSV file attachment."""
    csv_content, filename = export_review(session_id, db)
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/reviews/{session_id}")
def admin_delete_review(session_id: str, db: Session = Depends(get_db)):
    """Delete a review by session_id."""
    with db_transaction(db, "Failed to delete review"):
        delete_review(session_id, db)
    return {"success": True, "deleted_session_id": session_id}
