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

    raw_final = row.final_output
    final_output: dict = raw_final if isinstance(raw_final, dict) else json.loads(raw_final or "{}")

    raw_corrections = row.corrections
    corrections: list = raw_corrections if isinstance(raw_corrections, list) else json.loads(raw_corrections or "[]")
    corrected_fields = {c.get("fieldName", "") for c in corrections}

    template_svc = get_template_service()

    BLANK_ROW_BEFORE = {
        "Total Revenue",
        "LTM - Adj EBITDA items",
        "Balance Sheet",
        "Property, Plant & Equipment",
        "LIABILITIES",
        "Total Current Liabilities",
        "Long Term Loans",
        "EQUITY",
        "Cash Flow Statement",
        "CAPEX",
    }

    output = io.StringIO()
    writer = csv.writer(output)

    flat_values: dict = {}

    for stmt_label, stmt_key in [
        ("Income Statement", "income_statement"),
        ("Balance Sheet", "balance_sheet"),
        ("Cash Flow Statement", "cash_flow_statement"),
    ]:
        stmt_values: dict = final_output.get(stmt_label, {})
        if not stmt_values:
            continue

        flat_values.update(stmt_values)

        if stmt_label in BLANK_ROW_BEFORE:
            writer.writerow(["", ""])
        writer.writerow([stmt_label, ""])

        sections = template_svc.template.get(stmt_key, {}).get("sections", [])

        for section in sections:
            header = section.get("header")
            if header:
                if header in BLANK_ROW_BEFORE:
                    writer.writerow(["", ""])
                writer.writerow([header, ""])
            for field in section.get("fields", []):
                if field in BLANK_ROW_BEFORE:
                    writer.writerow(["", ""])
                value = stmt_values.get(field)
                value_str = f"{value:.2f}" if value is not None else ""
                writer.writerow([field, value_str])

    return ExportResponse(
        session_id=session_id,
        csv_content=output.getvalue(),
        final_values=flat_values,
    )
