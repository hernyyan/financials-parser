/**
 * classifyRows — pure row builders for Step 2 classification tables.
 *
 * Exported:
 *   buildSourceRows(layer1Results) → DataTableRow[]
 *       Flat list: statement header + one row per extracted line item.
 *
 *   buildTemplateRows(sections, statementLabel, layer2, corrections, selectedCell, pendingValues)
 *       → DataTableRow[]
 *       Flat list: statement header + optional section headers + one row per
 *       template field, with flagged/correction/pending/style metadata applied.
 *       pendingValues: non-null means live-edit mode — overrides correction display.
 */
import { formatFieldValue } from './formatters'
import { BOLD_FIELDS, ITALIC_FIELDS, isIndented } from './templateStyling'
import { getFailingFieldNames } from './finalizeRows'
import type { Correction, Layer2Result, TemplateSection } from '../types'
import type { DataTableRow } from '../components/shared/DataTable'

function formatSourceValue(value: number): string {
  if (value === 0) return '—'
  const abs = Math.abs(value)
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return value < 0 ? `(${formatted})` : formatted
}

export function buildSourceRows(
  layer1Results: Record<string, { lineItems: Record<string, number> }>,
): DataTableRow[] {
  const rows: DataTableRow[] = []
  for (const [sheetName, result] of Object.entries(layer1Results)) {
    if (!result) continue
    rows.push({ label: sheetName, value: null, isStatementHeader: true })
    for (const [label, value] of Object.entries(result.lineItems)) {
      rows.push({ label, value: formatSourceValue(value) })
    }
  }
  return rows
}

export function buildTemplateRows(
  sections: TemplateSection[],
  statementLabel: string,
  layer2: Layer2Result | undefined,
  corrections: Correction[],
  selectedCell: string | null,
  pendingValues: Record<string, number | null> | null,
): DataTableRow[] {
  const rows: DataTableRow[] = []
  const failingFields = getFailingFieldNames(layer2)

  rows.push({ label: statementLabel, value: null, isStatementHeader: true })

  for (const section of sections) {
    if (section.header) {
      rows.push({ label: section.header, value: null, isHeader: true })
    }
    for (const field of section.fields) {
      const correction = corrections.find((c) => c.fieldName === field)
      const isPending = pendingValues !== null
      // Use pending values for live preview — overrides corrections too
      const rawValue = isPending
        ? (pendingValues[field] ?? null)
        : correction
        ? correction.correctedValue
        : layer2
        ? (layer2.values[field] ?? null)
        : null

      const isFlagged = layer2?.flaggedFields.includes(field) ?? false
      const hasValidationFail = failingFields.has(field)
      // Highlight the actively-edited field in amber when pending
      const isBeingEdited = isPending && field === selectedCell

      rows.push({
        label: field,
        value: rawValue !== null ? formatFieldValue(field, rawValue) : null,
        isFlagged,
        hasValidationFail,
        isClickable: true,
        isEdited: isBeingEdited ? false : !!correction,
        isPending: isBeingEdited,
        isBold: BOLD_FIELDS.has(field),
        isIndented: isIndented(field),
        isItalic: ITALIC_FIELDS.has(field),
      })
    }
  }

  return rows
}
