/**
 * statementMeta — canonical constants for the three financial statement types.
 *
 * Single source of truth for:
 *   ALL_STATEMENT_TYPES   — ordered array used for iteration and exhaustiveness
 *   STATEMENT_LABELS      — full display names (e.g. "Income Statement")
 *   STATEMENT_ABBREVS     — short tab labels (e.g. "IS")
 *
 * Import these instead of declaring local label maps or type arrays inline.
 */
import type { StatementType } from '../types'

export const ALL_STATEMENT_TYPES: StatementType[] = [
  'income_statement',
  'balance_sheet',
  'cash_flow_statement',
]

export const STATEMENT_LABELS: Record<StatementType, string> = {
  income_statement: 'Income Statement',
  balance_sheet: 'Balance Sheet',
  cash_flow_statement: 'Cash Flow Statement',
}

export const STATEMENT_ABBREVS: Record<StatementType, string> = {
  income_statement: 'IS',
  balance_sheet: 'BS',
  cash_flow_statement: 'CFS',
}

/**
 * Create a Record keyed by all three StatementTypes, each mapped to `value`.
 * Use instead of hardcoding `{ income_statement: x, balance_sheet: x, cash_flow_statement: x }`.
 */
export function createStmtRecord<T>(value: T): Record<StatementType, T> {
  return Object.fromEntries(ALL_STATEMENT_TYPES.map((s) => [s, value])) as Record<StatementType, T>
}
