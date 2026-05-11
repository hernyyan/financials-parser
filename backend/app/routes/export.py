"""
GET /export/{session_id}/csv — Generate a CSV export of the finalized output.
Returns the CSV as a string in JSON (frontend renders it as a table).
"""
import csv
import io

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.schemas import ExportResponse
from app.db.database import get_db
from app.services.template_service import get_template_service
from app.utils.json_utils import deserialize_dict, deserialize_list
from app.utils.statement_meta import STATEMENT_TYPES

router = APIRouter()


@router.get("/export/{session_id}/csv", response_model=ExportResponse)
def get_export(session_id: str, db: Session = Depends(get_db)):
    """
    Load the finalized record from the database and build a CSV matching the
    firm's template format: Field Name, Value, Status.
    Section headers appear as rows with blank value/status cells.
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

    final_output: dict = deserialize_dict(row.final_output)
    corrections: list = deserialize_list(row.corrections)
    corrected_fields = {c.get("fieldName", "") for c in corrections}

    template_svc = get_template_service()

    blank_row_before = template_svc.blank_row_before_fields

    output = io.StringIO()
    writer = csv.writer(output)

    flat_values: dict = {}

    for stmt_key, stmt_label in STATEMENT_TYPES:
        stmt_values: dict = final_output.get(stmt_label, {})
        if not stmt_values:
            continue

        flat_values.update(stmt_values)

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

    return ExportResponse(
        session_id=session_id,
        csv_content=output.getvalue(),
        final_values=flat_values,
    )
