"""
Deterministic recalculation of all computed fields for IS, BS, and CFS.

Input: dict of field_name → value (float or None) for one statement type.
Output: same dict with all calculated fields overwritten by formula results,
        plus a 'calculationMeta' dict describing each calculated field's
        formula, inputs used, Python result, and whether it was overridden.

All arithmetic uses Python floats. Rounding tolerance for flag checks: $1.00.
"""

from typing import Dict, List, Optional

TOLERANCE = 1.0  # dollars


def recalculate_income_statement(
    values: Dict[str, Optional[float]],
    ai_matched: Dict[str, Optional[float]],
    overrides: Dict[str, float],
) -> Dict:
    v = dict(values)
    meta = {}
    flagged: List[str] = []

    def get(field):
        return v.get(field) or 0.0

    # Gross Profit
    gp_result = get('Total Revenue') - get('COGS')
    gp = _apply_calculated('Gross Profit', gp_result, overrides, v, meta, flagged,
        formula='Total Revenue − COGS',
        inputs={'Total Revenue': get('Total Revenue'), 'COGS': get('COGS')},
        ai_matched_value=ai_matched.get('Gross Profit'),
    )

    # EBITDA - Standard
    ebitda_result = gp - get('Total Operating Expenses')
    ebitda = _apply_calculated('EBITDA - Standard', ebitda_result, overrides, v, meta, flagged,
        formula='Gross Profit − Total Operating Expenses',
        inputs={'Gross Profit': gp, 'Total Operating Expenses': get('Total Operating Expenses')},
        ai_matched_value=ai_matched.get('EBITDA - Standard'),
    )

    # Adjusted EBITDA - Standard (special case when EBITDA Adjustments is null)
    adj = v.get('EBITDA Adjustments')
    if adj is not None:
        adj_ebitda_result = ebitda + adj
        _apply_calculated('Adjusted EBITDA - Standard', adj_ebitda_result, overrides, v, meta, flagged,
            formula='EBITDA - Standard + EBITDA Adjustments',
            inputs={'EBITDA - Standard': ebitda, 'EBITDA Adjustments': adj},
            ai_matched_value=ai_matched.get('Adjusted EBITDA - Standard'),
        )
    else:
        ai_val = ai_matched.get('Adjusted EBITDA - Standard')
        if ai_val is not None:
            v['Adjusted EBITDA - Standard'] = ai_val
        meta['Adjusted EBITDA - Standard'] = {
            'type': 'source_matched_fallback',
            'reason': 'EBITDA Adjustments not found in source — formula unavailable',
            'ai_matched_value': ai_val,
            'formula': 'EBITDA - Standard + EBITDA Adjustments',
        }

    # Net Income (Loss)
    net_result = (ebitda
        - get('Depreciation & Amortization')
        - get('Interest Expense/(Income)')
        - get('Other Expense / (Income)')
        - get('Taxes'))
    _apply_calculated('Net Income (Loss)', net_result, overrides, v, meta, flagged,
        formula='EBITDA - Standard − D&A − Interest − Other Expense/(Income) − Taxes',
        inputs={
            'EBITDA - Standard': ebitda,
            'Depreciation & Amortization': get('Depreciation & Amortization'),
            'Interest Expense/(Income)': get('Interest Expense/(Income)'),
            'Other Expense / (Income)': get('Other Expense / (Income)'),
            'Taxes': get('Taxes'),
        },
        ai_matched_value=ai_matched.get('Net Income (Loss)'),
    )

    # Adjusted EBITDA - Including Cures (only if at least one LTM/Cure item is non-null)
    ltm = v.get('LTM - Adj EBITDA items')
    cure = v.get('Equity Cure')
    adj_ebitda_std = v.get('Adjusted EBITDA - Standard')
    if (ltm is not None or cure is not None) and adj_ebitda_std is not None:
        cures_result = adj_ebitda_std + (ltm or 0.0) + (cure or 0.0)
        _apply_calculated('Adjusted EBITDA - Including Cures', cures_result, overrides, v, meta, flagged,
            formula='Adjusted EBITDA - Standard + LTM - Adj EBITDA items + Equity Cure',
            inputs={
                'Adjusted EBITDA - Standard': adj_ebitda_std,
                'LTM - Adj EBITDA items': ltm,
                'Equity Cure': cure,
            },
            ai_matched_value=ai_matched.get('Adjusted EBITDA - Including Cures'),
        )

    return {'values': v, 'calculationMeta': meta, 'flaggedFields': flagged}


def recalculate_balance_sheet(
    values: Dict[str, Optional[float]],
    ai_matched: Dict[str, Optional[float]],
    overrides: Dict[str, float],
) -> Dict:
    v = dict(values)
    meta = {}
    flagged: List[str] = []

    def get(field):
        return v.get(field) or 0.0

    # Total Current Assets
    tca_result = (get('Cash & Cash Equivalents') + get('Accounts Receivable')
        + get('Inventory') + get('Prepaid Expenses') + get('Other Current Assets'))
    tca = _apply_calculated('Total Current Assets', tca_result, overrides, v, meta, flagged,
        formula='Cash + AR + Inventory + Prepaid + Other Current Assets',
        inputs={k: get(k) for k in ['Cash & Cash Equivalents', 'Accounts Receivable',
            'Inventory', 'Prepaid Expenses', 'Other Current Assets']},
        ai_matched_value=ai_matched.get('Total Current Assets'),
    )

    # Total Non-Current Assets (Accumulated Depreciation stored as negative)
    tnca_result = (get('Property, Plant & Equipment') + get('Accumulated Depreciation')
        + get('Goodwill & Intangibles') + get('Other non-current assets'))
    tnca = _apply_calculated('Total Non-Current Assets', tnca_result, overrides, v, meta, flagged,
        formula='PP&E + Accumulated Depreciation (negative) + Goodwill & Intangibles + Other Non-Current Assets',
        inputs={k: get(k) for k in ['Property, Plant & Equipment', 'Accumulated Depreciation',
            'Goodwill & Intangibles', 'Other non-current assets']},
        ai_matched_value=ai_matched.get('Total Non-Current Assets'),
    )

    # Total Assets
    ta_result = tca + tnca
    ta = _apply_calculated('Total Assets', ta_result, overrides, v, meta, flagged,
        formula='Total Current Assets + Total Non-Current Assets',
        inputs={'Total Current Assets': tca, 'Total Non-Current Assets': tnca},
        ai_matched_value=ai_matched.get('Total Assets'),
    )

    # Total Current Liabilities
    tcl_result = (get('Accounts Payable') + get('Accrued Liabilities') + get('Deferred Revenue')
        + get('Revolver - Balance Sheet') + get('Current Maturities') + get('Other Current Liabilities'))
    tcl = _apply_calculated('Total Current Liabilities', tcl_result, overrides, v, meta, flagged,
        formula='AP + Accrued + Deferred Revenue + Revolver + Current Maturities + Other Current Liabilities',
        inputs={k: get(k) for k in ['Accounts Payable', 'Accrued Liabilities', 'Deferred Revenue',
            'Revolver - Balance Sheet', 'Current Maturities', 'Other Current Liabilities']},
        ai_matched_value=ai_matched.get('Total Current Liabilities'),
    )

    # Total Non-Current Liabilities
    tncl_result = get('Long Term Loans') + get('Long Term Leases') + get('Other Non-Current Liabilities')
    tncl = _apply_calculated('Total Non-Current Liabilities', tncl_result, overrides, v, meta, flagged,
        formula='Long Term Loans + Long Term Leases + Other Non-Current Liabilities',
        inputs={k: get(k) for k in ['Long Term Loans', 'Long Term Leases', 'Other Non-Current Liabilities']},
        ai_matched_value=ai_matched.get('Total Non-Current Liabilities'),
    )

    # Total Liabilities
    tl_result = tcl + tncl
    tl = _apply_calculated('Total Liabilities', tl_result, overrides, v, meta, flagged,
        formula='Total Current Liabilities + Total Non-Current Liabilities',
        inputs={'Total Current Liabilities': tcl, 'Total Non-Current Liabilities': tncl},
        ai_matched_value=ai_matched.get('Total Liabilities'),
    )

    # Total Equity
    te_result = get('Paid in Capital') + get('Retained Earnings') + get('Other Equity')
    te = _apply_calculated('Total Equity', te_result, overrides, v, meta, flagged,
        formula='Paid in Capital + Retained Earnings + Other Equity',
        inputs={k: get(k) for k in ['Paid in Capital', 'Retained Earnings', 'Other Equity']},
        ai_matched_value=ai_matched.get('Total Equity'),
    )

    # Total Liabilities and Equity
    tle_result = tl + te
    tle = _apply_calculated('Total Liabilities and Equity', tle_result, overrides, v, meta, flagged,
        formula='Total Liabilities + Total Equity',
        inputs={'Total Liabilities': tl, 'Total Equity': te},
        ai_matched_value=ai_matched.get('Total Liabilities and Equity'),
    )

    # Check — always calculated, always read-only, never in overrides
    check_result = ta - tle
    v['Check'] = round(check_result, 2)
    meta['Check'] = {
        'type': 'calculated',
        'formula': 'Total Assets − Total Liabilities and Equity',
        'inputs': {'Total Assets': ta, 'Total Liabilities and Equity': tle},
        'python_result': check_result,
        'ai_matched_value': None,
        'match_status': 'n/a',
        'readonly': True,
    }
    if abs(check_result) > TOLERANCE:
        flagged.append('Check')

    return {'values': v, 'calculationMeta': meta, 'flaggedFields': flagged}


def recalculate_cash_flow_statement(
    values: Dict[str, Optional[float]],
    ai_matched: Dict[str, Optional[float]],
    overrides: Dict[str, float],
) -> Dict:
    v = dict(values)
    meta = {}
    flagged: List[str] = []

    def get(field):
        return v.get(field) or 0.0

    ocf_result = (get('Operating Cash Flow (Working Capital)')
        + get('Operating Cash Flow (Non-Working Capital)'))
    _apply_calculated('Operating Cash Flow', ocf_result, overrides, v, meta, flagged,
        formula='Operating Cash Flow (Working Capital) + Operating Cash Flow (Non-Working Capital)',
        inputs={
            'Operating Cash Flow (Working Capital)': get('Operating Cash Flow (Working Capital)'),
            'Operating Cash Flow (Non-Working Capital)': get('Operating Cash Flow (Non-Working Capital)'),
        },
        ai_matched_value=ai_matched.get('Operating Cash Flow'),
    )

    return {'values': v, 'calculationMeta': meta, 'flaggedFields': flagged}


def _apply_calculated(
    field: str,
    formula_result: float,
    overrides: Dict[str, float],
    v: Dict,
    meta: Dict,
    flagged: list,
    formula: str,
    inputs: Dict,
    ai_matched_value: Optional[float],
) -> float:
    """
    Applies a calculated field. If an override exists, use it but check if it
    breaks the formula. Always returns the value actually stored in v[field].
    """
    rounded_result = round(formula_result, 2)

    if field in overrides:
        override_val = overrides[field]
        v[field] = override_val
        math_ok = abs(override_val - rounded_result) <= TOLERANCE
        if not math_ok:
            flagged.append(field)
        meta[field] = {
            'type': 'overridden',
            'formula': formula,
            'inputs': inputs,
            'python_result': rounded_result,
            'override_value': override_val,
            'math_ok': math_ok,
            'ai_matched_value': ai_matched_value,
            'match_status': _match_status(rounded_result, ai_matched_value),
        }
        return override_val
    else:
        v[field] = rounded_result
        meta[field] = {
            'type': 'calculated',
            'formula': formula,
            'inputs': inputs,
            'python_result': rounded_result,
            'ai_matched_value': ai_matched_value,
            'match_status': _match_status(rounded_result, ai_matched_value),
        }
        return rounded_result


def _match_status(python_result: float, ai_val: Optional[float]) -> str:
    if ai_val is None:
        return 'not_found_in_source'
    if abs(python_result - ai_val) <= TOLERANCE:
        return 'match'
    return 'discrepancy'
