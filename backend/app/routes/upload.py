"""
POST /upload             — Accept an Excel workbook, extract CSVs for Layer 1, return session info.
GET  /files/{session_id}/workbook — Serve the original uploaded workbook for client-side preview.
"""
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import UPLOADS_DIR, PROCESSED_DIR
from app.db.database import get_db
from app.models.schemas import UploadResponse
from app.services.excel_processor import convert_to_csvs, _safe_filename

router = APIRouter()

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


@router.post("/upload", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    company_name: str = Form(...),
    reporting_period: str = Form(...),
    db: Session = Depends(get_db),
):
    """
    Accept an Excel workbook upload.

    Steps:
    1. Validate file type (.xlsx/.xls) and size (max 50 MB).
    2. Save original file to uploads/{session_id}/original.xlsx.
    3. Convert each visible sheet to CSV → processed/{session_id}/{safe_name}.csv (for Layer 1).
    4. Create a review record in the database.
    5. Return sessionId, sheetNames, workbookUrl (for client-side Excel preview).
    """
    filename = file.filename or ""
    if not filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=400,
            detail="Only .xlsx and .xls files are accepted.",
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail="File too large. Maximum allowed size is 50 MB.",
        )

    session_id = str(uuid.uuid4())

    # Per-session directories
    upload_session_dir = UPLOADS_DIR / session_id
    upload_session_dir.mkdir(parents=True, exist_ok=True)
    processed_session_dir = PROCESSED_DIR / session_id
    processed_session_dir.mkdir(parents=True, exist_ok=True)

    upload_path = upload_session_dir / "original.xlsx"
    upload_path.write_bytes(content)

    # Convert to CSVs and save to disk for Layer 1
    try:
        csv_contents = convert_to_csvs(str(upload_path))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read sheet data: {e}",
        )

    if not csv_contents:
        raise HTTPException(
            status_code=400,
            detail="No visible, non-empty sheets found in the workbook.",
        )

    for sheet_name, csv_text in csv_contents.items():
        safe_name = _safe_filename(sheet_name)
        csv_path = processed_session_dir / f"{safe_name}.csv"
        csv_path.write_text(csv_text, encoding="utf-8")

    sheet_names = list(csv_contents.keys())
    workbook_url = f"/files/{session_id}/workbook"

    # Create DB record (non-fatal)
    try:
        db.execute(
            text(
                "INSERT INTO reviews (session_id, company_name, reporting_period, status) "
                "VALUES (:sid, :cn, :rp, 'in_progress')"
            ),
            {"sid": session_id, "cn": company_name, "rp": reporting_period},
        )
        db.commit()
    except Exception:
        db.rollback()

    return UploadResponse(
        sessionId=session_id,
        sheetNames=sheet_names,
        workbookUrl=workbook_url,
    )


@router.get("/files/{session_id}/workbook")
def serve_workbook(session_id: str):
    """Serve the original uploaded Excel file for client-side preview."""
    workbook_path = UPLOADS_DIR / session_id / "original.xlsx"
    if not workbook_path.exists():
        raise HTTPException(status_code=404, detail="Workbook not found.")
    return FileResponse(
        path=str(workbook_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="workbook.xlsx",
    )
