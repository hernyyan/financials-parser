/**
 * Formula calculation utilities for Layer 2 formula-based mapping.
 *
 * Formulas reference L1 source rows by row number (source_row). Calculation
 * happens entirely on the frontend using the L1 structured tree already in
 * wizard state — no backend call needed.
 */

import type { FormulaRow, L2Formula, Layer1TemplateRow } from '../types'

// ── L1 row value map ───────────────────────────────────────────────────────────

/**
 * Recursively walks the L1 structured rows tree and builds a map of
 * source_row number → value. Section breaks are skipped.
 */
export function buildL1ValueMap(rows: Layer1TemplateRow[]): Map<number, number | null> {
  const map = new Map<number, number | null>()

  function walk(nodes: Layer1TemplateRow[]): void {
    for (const row of nodes) {
      if ((row as any).isSectionBreak) continue
      const rowNum = row.source_row
      if (rowNum && rowNum > 0) {
        map.set(rowNum, row.value ?? null)
      }
      if (row.children?.length) {
        walk(row.children)
      }
    }
  }

  walk(rows)
  return map
}

// ── Formula execution ──────────────────────────────────────────────────────────

/**
 * Execute a formula against the L1 value map.
 * Returns the computed number, or null if no row values could be resolved.
 */
export function calculateFormulaValue(
  formula: L2Formula,
  valueMap: Map<number, number | null>,
): number | null {
  if (!formula || formula.length === 0) return null

  let total: number | null = null

  for (const fr of formula) {
    const val = valueMap.get(fr.row)
    if (val == null) continue
    if (total === null) {
      total = fr.operator === '+' ? val : -val
    } else {
      total = fr.operator === '+' ? total + val : total - val
    }
  }

  return total !== null ? Math.round(total * 100) / 100 : null
}

// ── Display formatting ─────────────────────────────────────────────────────────

/**
 * Format a formula as a clean horizontal expression for display.
 * First row's '+' operator is hidden (implied). '-' is always shown.
 *
 * Examples:
 *   [{ op: '+', row: 75, label: 'Net Income' }]
 *     → "Net Income [75]"
 *   [{ op: '+', row: 75, label: 'Net Income' }, { op: '-', row: 67, label: 'R&D Addbacks' }]
 *     → "Net Income [75] − R&D Addbacks [67]"
 *   [{ op: '-', row: 10, label: 'Returns' }]
 *     → "−Returns [10]"
 */
export function formatFormula(formula: L2Formula): string {
  if (!formula || formula.length === 0) return '—'

  return formula
    .map((fr, i) => {
      const term = `${fr.label} [${fr.row}]`
      if (i === 0) {
        return fr.operator === '-' ? `−${term}` : term
      }
      return fr.operator === '-' ? ` − ${term}` : ` + ${term}`
    })
    .join('')
}

// ── Valid row check ────────────────────────────────────────────────────────────

/**
 * Check whether a row number exists in the L1 value map.
 * Used by FormulaEditor to validate row number inputs on blur.
 */
export function isValidL1Row(
  rowNum: number,
  valueMap: Map<number, number | null>,
): boolean {
  return valueMap.has(rowNum)
}
