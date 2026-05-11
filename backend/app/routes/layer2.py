"""
POST /layer2/run — Run Layer 2 AI classification on Layer 1 extraction output.

Uses a synchronous `def` route so FastAPI automatically runs it in a thread pool.
This avoids the async/sync mismatch that occurs when a synchronous Anthropic SDK call
is made inside an `async def` handler, which would block the event loop.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.db.database import get_db
from app.db.review_store import merge_layer2_data
from app.db.transaction import db_transaction
from app.models.schemas import Layer2Request, Layer2Response
from app.services.layer2_service import get_layer2_service
from app.utils.claude_errors import claude_api_errors

router = APIRouter()


@router.post("/layer2/run", response_model=Layer2Response)
def run_layer2(request: Layer2Request, db: Session = Depends(get_db)):
    """
    Run Layer 2 classification for a single statement type.

    Declared as a plain `def` so FastAPI runs it in its thread pool executor,
    allowing the synchronous Anthropic SDK call to block without affecting the event loop.
    """
    logger.info("Layer 2 starting for %s", request.statement_type)
    service = get_layer2_service()
    try:
        with claude_api_errors():
            result = service.run_classification(
                statement_type=request.statement_type,
                layer1_data=request.layer1_data,
                company_id=request.company_id,
                use_company_context=request.use_company_context or False,
                db=db,
            )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Persist layer2_data to DB (non-fatal — classification result returned regardless)
    if request.session_id:
        with db_transaction(db, "Layer 2 DB persistence failed", fatal=False):
            merge_layer2_data(db, request.session_id, request.statement_type, result)

    logger.info("Layer 2 completed for %s", request.statement_type)
    return result
