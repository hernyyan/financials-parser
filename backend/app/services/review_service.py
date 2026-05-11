"""
Review session query and lifecycle logic.

Owns all reads and writes to the reviews table that aren't already
handled by review_store (which owns low-level JSON-column merges):

  check_existing_finalized  — look up the latest finalized session for a
                              company+period (used by duplicate-check guard)
  continue_from_previous    — create a new in-progress session pre-populated
                              from the latest finalized review for a period
  list_reviews              — paginated list with optional status/company
                              filters and corrections count
  export_review             — fetch final_output and build the CSV payload
  delete_review             — lookup + delete by session_id
"""
import re
import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.services.template_service import get_template_service
from app.utils.json_utils import deserialize_dict, deserialize_list


# ── Wizard-flow operations ────────────────────────────────────────────────────

def check_existing_finalized(
    company_name: str,
    reporting_period: str,
    db: Session,
) -> dict[str, Any]:
    """
    Return the latest finalized session for a company+period, or
    {"exists": False} if none exists.
    """
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


def continue_from_previous(
    company_name: str,
    reporting_period: str,
    db: Session,
) -> dict[str, Any]:
    """
    Create a new in-progress review session pre-populated from the latest
    finalized review for the given company+period.

    Raises HTTPException 404 if no finalized review exists.
    Does NOT commit — caller owns the transaction boundary.
    """
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
        {"name": company_name, "period": reporting_period},
    ).fetchone()

    if not source:
        raise HTTPException(
            status_code=404,
            detail="No finalized review found for this period.",
        )

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
            "period": reporting_period,
            "l1": source[1],
            "l2": source[2],
            "corrections": source[3],
        },
    )

    return {
        "session_id": new_session_id,
        "company_name": company_name,
        "reporting_period": reporting_period,
        "layer1_data": deserialize_dict(source[1]),
        "layer2_data": deserialize_dict(source[2]),
        "corrections": deserialize_list(source[3]),
    }


# ── Admin operations ──────────────────────────────────────────────────────────

def list_reviews(
    db: Session,
    status: str | None = None,
    company: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """
    Return a paginated list of reviews newest-first with optional filters.
    Each entry includes a corrections_count derived from the corrections JSON.
    """
    conditions: list[str] = []
    params: dict[str, Any] = {}

    if status:
        conditions.append("status = :status")
        params["status"] = status
    if company:
        conditions.append("LOWER(company_name) LIKE :company")
        params["company"] = f"%{company.lower()}%"

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    total: int = db.execute(
        text(f"SELECT COUNT(*) FROM reviews {where_clause}"),  # noqa: S608
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
        """),  # noqa: S608
        {**params, "limit": limit},
    ).fetchall()

    reviews = [
        {
            "id": row[0],
            "session_id": row[1],
            "company_name": row[2],
            "reporting_period": row[3],
            "status": row[4],
            "created_at": row[5],
            "finalized_at": row[6],
            "corrections_count": len(deserialize_list(row[7])),
        }
        for row in rows
    ]
    return {"total": total, "reviews": reviews}


def export_review(session_id: str, db: Session) -> tuple[bytes, str]:
    """
    Build a CSV export for a finalized review.

    Returns (csv_bytes, filename).
    Raises HTTPException 404 if the session doesn't exist.
    """
    row = db.execute(
        text("""
            SELECT company_name, reporting_period, final_output
            FROM reviews WHERE session_id = :sid
        """),
        {"sid": session_id},
    ).fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail=f"Session '{session_id}' not found or not yet finalized.",
        )

    final_output = deserialize_dict(row[2])
    csv_content = get_template_service().build_export_csv(final_output)

    safe_company = re.sub(r"[^\w\s-]", "", row[0]).strip().replace(" ", "_")
    safe_period = re.sub(r"[^\w\s-]", "", row[1]).strip().replace(" ", "_")
    filename = f"{safe_company}_{safe_period}.csv"

    return csv_content, filename


def delete_review(session_id: str, db: Session) -> None:
    """
    Delete a review by session_id.
    Raises HTTPException 404 if not found. Does NOT commit — caller owns the transaction boundary.
    """
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


def get_export_data(session_id: str, db: Session) -> dict[str, Any]:
    """
    Load a finalized review and return all data needed to build an export response:
      csv_content      — CSV string from template_service
      final_values     — flat dict of all field → value across all statements
      corrected_fields — set of field names that have analyst corrections

    Raises HTTPException 404 if not found.
    """
    row = db.execute(
        text(
            "SELECT company_name, reporting_period, final_output, corrections "
            "FROM reviews WHERE session_id = :sid"
        ),
        {"sid": session_id},
    ).fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail=f"Session '{session_id}' not found or not yet finalized.",
        )

    final_output: dict = deserialize_dict(row[2])
    corrections: list = deserialize_list(row[3])

    csv_content = get_template_service().build_export_csv(final_output)

    flat_values: dict = {}
    for stmt_values in final_output.values():
        if isinstance(stmt_values, dict):
            flat_values.update(stmt_values)

    corrected_fields = {c.get("fieldName", "") for c in corrections}

    return {
        "session_id": session_id,
        "csv_content": csv_content,
        "final_values": flat_values,
        "corrected_fields": corrected_fields,
    }
