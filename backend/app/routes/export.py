"""
GET /export/{session_id}/csv — Generate a CSV export of the finalized output.
Returns the CSV as a string in JSON (frontend renders it as a table).
"""
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.schemas import ExportResponse
from app.db.database import get_db
from app.services.template_service import get_template_service
from app.utils.json_utils import deserialize_dict, deserialize_list

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
    csv_content = template_svc.build_export_csv(final_output)

    flat_values: dict = {}
    for stmt_values in final_output.values():
        if isinstance(stmt_values, dict):
            flat_values.update(stmt_values)

    return ExportResponse(
        session_id=session_id,
        csv_content=csv_content,
        final_values=flat_values,
    )
