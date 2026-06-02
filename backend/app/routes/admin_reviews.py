"""
Admin endpoints for review management.

GET    /admin/reviews                      — List all reviews with optional filters
GET    /admin/reviews/{session_id}/export  — Download finalized output as CSV attachment
DELETE /admin/reviews/{session_id}         — Delete a review
"""
import csv
import json
import re
from io import StringIO
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.db.database import get_db
from app.services.template_service import get_template_service

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
        corrections_raw = row[7]
        try:
            corrections_list = (
                json.loads(corrections_raw)
                if isinstance(corrections_raw, str)
                else (corrections_raw or [])
            )
            corrections_count = len(corrections_list) if isinstance(corrections_list, list) else 0
        except (json.JSONDecodeError, TypeError):
            corrections_count = 0

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
    final_output: dict = json.loads(row[2]) if isinstance(row[2], str) else (row[2] or {})
    corrections: list = json.loads(row[3]) if isinstance(row[3], str) else (row[3] or [])

    template_svc = get_template_service()
    blank_row_before = template_svc.blank_row_before_fields

    output = StringIO()
    writer = csv.writer(output)

    for stmt_label, stmt_key in [
        ("Income Statement", "income_statement"),
        ("Balance Sheet", "balance_sheet"),
        ("Cash Flow Statement", "cash_flow_statement"),
    ]:
        stmt_values: dict = final_output.get(stmt_label, {})
        if not stmt_values:
            continue

        if stmt_label in blank_row_before:
            writer.writerow(["", ""])
        writer.writerow([stmt_label, ""])

        sections = template_svc.template.get(stmt_key, {}).get("sections", [])

        for section in sections:
            header = section.get("header")
            if header:
                if header in blank_row_before:
                    writer.writerow(["", ""])
                writer.writerow([header, ""])
            for field in section.get("fields", []):
                if field in blank_row_before:
                    writer.writerow(["", ""])
                value = stmt_values.get(field)
                value_str = f"{value:.2f}" if value is not None else ""
                writer.writerow([field, value_str])

    safe_company = re.sub(r"[^\w\s-]", "", company_name).strip().replace(" ", "_")
    safe_period = re.sub(r"[^\w\s-]", "", reporting_period).strip().replace(" ", "_")
    filename = f"{safe_company}_{safe_period}.csv"

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/backfill-company-ids")
def admin_backfill_company_ids(db: Session = Depends(get_db)):
    """
    One-time data migration: match reviews rows to companies by case-insensitive
    name, stamping company_id where it is currently NULL.

    Also nullifies id=31 (superseded USBid Jan 2026 duplicate — canonical row is id=56).
    Safe to run multiple times — the UPDATE only touches rows where company_id IS NULL.
    """
    result = db.execute(text("""
        UPDATE reviews
        SET company_id = (
            SELECT id FROM companies
            WHERE LOWER(TRIM(companies.name)) = LOWER(TRIM(reviews.company_name))
            LIMIT 1
        )
        WHERE company_id IS NULL
          AND company_name != ''
    """))
    matched = result.rowcount

    # Nullify the superseded duplicate so it doesn't violate the unique index
    db.execute(text("UPDATE reviews SET company_id = NULL WHERE id = 31"))

    db.commit()

    unmatched_finalized = db.execute(text("""
        SELECT id, company_name, reporting_period
        FROM reviews
        WHERE company_id IS NULL AND company_name != '' AND final_output IS NOT NULL
    """)).fetchall()

    return {
        "matched_rows": matched,
        "unmatched_finalized": [
            {"id": r[0], "company_name": r[1], "period": r[2]}
            for r in unmatched_finalized
        ],
    }


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
