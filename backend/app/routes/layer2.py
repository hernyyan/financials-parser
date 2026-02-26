"""
POST /layer2/run — Run Layer 2 AI classification on Layer 1 extraction output.

Uses a synchronous `def` route so FastAPI automatically runs it in a thread pool.
This avoids the async/sync mismatch that occurs when a synchronous Anthropic SDK call
is made inside an `async def` handler, which would block the event loop.
"""
import json

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.db.database import get_db
from app.models.schemas import Layer2Request, Layer2Response
from app.services.layer2_service import get_layer2_service

router = APIRouter()


@router.post("/layer2/run", response_model=Layer2Response)
def run_layer2(request: Layer2Request, db: Session = Depends(get_db)):
    """
    Run Layer 2 classification for a single statement type.

    Declared as a plain `def` so FastAPI runs it in its thread pool executor,
    allowing the synchronous Anthropic SDK call to block without affecting the event loop.
    """
    print(f"Layer 2 starting for {request.statement_type}")
    service = get_layer2_service()
    try:
        result = service.run_classification(
            request.statement_type,
            request.layer1_data,
        )
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=401, detail="Invalid Anthropic API key.")
    except anthropic.RateLimitError:
        raise HTTPException(
            status_code=429,
            detail="Anthropic API rate limit reached. Please wait and retry.",
        )
    except anthropic.APITimeoutError:
        raise HTTPException(
            status_code=504,
            detail="Layer 2 classification timed out (>120s). Consider switching LAYER2_MODEL=claude-sonnet-4-6 in your .env for faster results.",
        )
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {e}")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Persist layer2_data to DB (non-fatal)
    if request.session_id:
        try:
            row = db.execute(
                text("SELECT layer2_data FROM reviews WHERE session_id = :sid"),
                {"sid": request.session_id},
            ).fetchone()
            existing_data = json.loads(row[0]) if row and row[0] else {}
            existing_data[request.statement_type] = result
            db.execute(
                text("UPDATE reviews SET layer2_data = :data WHERE session_id = :sid"),
                {"data": json.dumps(existing_data), "sid": request.session_id},
            )
            db.commit()
        except Exception:
            db.rollback()

    print(f"Layer 2 completed for {request.statement_type}")
    return result
