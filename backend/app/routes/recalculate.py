"""
POST /recalculate — Server-side recalculation of computed fields.
Called by frontend after any correction is saved to get authoritative values.
"""
from fastapi import APIRouter, HTTPException

from app.models.schemas import RecalculateRequest
from app.services.recalculate_service import (
    recalculate_income_statement,
    recalculate_balance_sheet,
    recalculate_cash_flow_statement,
)

router = APIRouter()

_RECALC_FN = {
    'income_statement': recalculate_income_statement,
    'balance_sheet': recalculate_balance_sheet,
    'cash_flow_statement': recalculate_cash_flow_statement,
}


@router.post('/recalculate')
def recalculate(request: RecalculateRequest):
    normalized = request.statement_type.lower().replace(' ', '_')
    fn = _RECALC_FN.get(normalized)
    if fn is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown statement_type '{request.statement_type}'.",
        )
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
