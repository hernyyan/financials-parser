"""
GET /export/{session_id}/csv — Generate a CSV export of the finalized output.
Returns the CSV as a string in JSON (frontend renders it as a table).
"""
import csv
import io
import json

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.schemas import ExportResponse
from app.db.database import get_db
from app.services.template_service import get_template_service

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

    final_output: dict = json.loads(row.final_output or "{}")
    corrections: list = json.loads(row.corrections or "[]")
    corrected_fields = {c.get("fieldName", "") for c in corrections}

    template_svc = get_template_service()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Field Name", "Value", "Status"])

    flat_values: dict = {}

    for stmt_label, stmt_key in [
        ("Income Statement", "income_statement"),
        ("Balance Sheet", "balance_sheet"),
    ]:
        writer.writerow([stmt_label, "", ""])
        sections = template_svc.template.get(stmt_key, {}).get("sections", [])
        stmt_values: dict = final_output.get(stmt_label, {})
        flat_values.update(stmt_values)

        for section in sections:
            header = section.get("header")
            if header:
                writer.writerow([header, "", ""])
            for field in section.get("fields", []):
                value = stmt_values.get(field)
                value_str = f"{value:.2f}" if value is not None else ""
                status = "corrected" if field in corrected_fields else ""
                writer.writerow([field, value_str, status])

        writer.writerow(["", "", ""])  # blank separator between statements

    return ExportResponse(
        session_id=session_id,
        csv_content=output.getvalue(),
        final_values=flat_values,
    )
