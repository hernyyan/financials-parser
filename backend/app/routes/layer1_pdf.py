"""
POST /layer1/run-pdf — Run Layer 1 AI extraction on selected PDF pages.
Uses the Claude API's native PDF document input.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import UPLOADS_DIR
from app.db.database import get_db
from app.db.transaction import db_transaction
from app.models.schemas import Layer1PdfRequest, Layer1Response
from app.services.layer1_pdf_service import get_layer1_pdf_service
from app.utils.claude_errors import claude_api_errors

router = APIRouter()


@router.post("/layer1/run-pdf", response_model=Layer1Response)
def run_layer1_pdf(request: Layer1PdfRequest, db: Session = Depends(get_db)):
    """
    Run Layer 1 extraction on selected PDF pages.
    Sends the selected pages as a native PDF document to Claude.
    """
    pdf_path = UPLOADS_DIR / request.sessionId / "original.pdf"
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF not found for this session.")

    service = get_layer1_pdf_service()
    with claude_api_errors():
        result = service.run_extraction(
            pdf_path=str(pdf_path),
            pages=request.pages,
            statement_type=request.statementType,
            reporting_period=request.reportingPeriod,
            session_id=request.sessionId,
            db=db,
        )

    # Persist to DB — non-fatal (extraction result is returned regardless)
    with db_transaction(db, "Layer 1 PDF DB persistence failed", fatal=False):
        pass  # service wrote to DB during run_extraction; just commit

    return Layer1Response(
        sheetName=result["sheetName"],
        lineItems=result["lineItems"],
        sourceScaling=result["sourceScaling"],
        columnIdentified=result["columnIdentified"],
    )
