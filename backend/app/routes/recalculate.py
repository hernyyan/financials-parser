"""
POST /recalculate — Server-side recalculation of computed fields.
Called by frontend after any correction is saved to get authoritative values.
"""
from fastapi import APIRouter, HTTPException

from app.models.schemas import RecalculateRequest
from app.services.recalculate_service import RECALC_FN
from app.utils.statement_meta import validate_statement_type

router = APIRouter()


@router.post('/recalculate')
def recalculate(request: RecalculateRequest):
    try:
        normalized = validate_statement_type(request.statement_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    fn = RECALC_FN[normalized]
    result = fn(
        values=request.values,
        ai_matched=request.values,  # use current values as ai_matched baseline
        overrides=request.overrides,
    )
    return {
        'values': result['values'],
        'calculationMeta': result['calculationMeta'],
        'flaggedFields': result['flaggedFields'],
    }
