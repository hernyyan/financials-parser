/**
 * finalizeRows — pure functions for building the Step 3 finalization table.
 *
 * Exported:
 *   getFailingFieldNames(layer2) → Set<string>
 *       Returns field names that participate in at least one FAIL validation
 *       check. Shared by Step2 (per-field check) and Step3 (pre-built set).
 *
 *   buildFinalizeRows(params) → FinalizeRow[]
 *       Produces the flat row list rendered by the Step 3 data table.
 *       Pure — all inputs passed explicitly, no component state captured.
 */
import { formatFieldValue } from './formatters'
import { BOLD_FIELDS, ITALIC_FIELDS, isIndented } from './templateStyling'
import type { Layer2Result, TemplateSection } from '../types'

export interface FinalizeRow {
  label: string
  classifiedValue: string | null
  finalValue: string | null
  rawFinalValue?: number | null
  isStatementHeader?: boolean
  isHeader?: boolean
  isBalanceCheck?: boolean
  corrected?: boolean
  flagged?: boolean
  validationFail?: boolean
  isBold?: boolean
  isIndented?: boolean
  isItalic?: boolean
}

// ── Shared validation helper ───────────────────────────────────────────────

/**
 * Return the set of field names that are involved in at least one failing
 * validation check for the given Layer 2 result.
 *
 * Algorithm: iterate failing check names, look up which fields reference
 * each check in fieldValidations, collect those fields.
 */
export function getFailingFieldNames(layer2: Layer2Result | undefined): Set<string> {
  if (!layer2) return new Set()
  const failing = new Set<string>()
  for (const [checkName, check] of Object.entries(layer2.validation ?? {})) {
    if (check.status === 'FAIL') {
      for (const [field, checks] of Object.entries(layer2.fieldValidations ?? {})) {
        if ((checks as string[]).includes(checkName)) {
          failing.add(field)
        }
      }
    }
  }
  return failing
}

// ── Row builder ────────────────────────────────────────────────────────────

interface BuildFinalizeRowsParams {
  isSections: TemplateSection[]
  bsSections: TemplateSection[]
  cfsSections: TemplateSection[]
  finalValues: {
    income_statement: Record<string, number | null>
    balance_sheet: Record<string, number | null>
    cash_flow_statement: Record<string, number | null>
  }
  isLayer2: Layer2Result | undefined
  bsLayer2: Layer2Result | undefined
  cfsLayer2: Layer2Result | undefined
  correctedFieldNames: Set<string>
  allFlaggedFields: Set<string>
  isFailingFields: Set<string>
  bsFailingFields: Set<string>
}

export function buildFinalizeRows({
  isSections,
  bsSections,
  cfsSections,
  finalValues,
  isLayer2,
  bsLayer2,
  cfsLayer2,
  correctedFieldNames,
  allFlaggedFields,
  isFailingFields,
  bsFailingFields,
}: BuildFinalizeRowsParams): FinalizeRow[] {
  const rows: FinalizeRow[] = []

  // Income Statement
  rows.push({ label: 'Income Statement', classifiedValue: null, finalValue: null, isStatementHeader: true })
  for (const section of isSections) {
    if (section.header) rows.push({ label: section.header, classifiedValue: null, finalValue: null, isHeader: true })
    for (const field of section.fields) {
      const rawFinalValue = finalValues.income_statement[field] ?? null
      const l2Value = isLayer2?.values[field] ?? null
      const corrected = correctedFieldNames.has(field)
      rows.push({
        label: field,
        classifiedValue: l2Value !== null ? formatFieldValue(field, l2Value) : null,
        finalValue: rawFinalValue !== null ? formatFieldValue(field, rawFinalValue) : null,
        rawFinalValue,
        corrected,
        flagged: allFlaggedFields.has(field) && !corrected,
        validationFail: isFailingFields.has(field) && !corrected,
        isBold: BOLD_FIELDS.has(field),
        isIndented: isIndented(field),
        isItalic: ITALIC_FIELDS.has(field),
      })
    }
  }

  // Balance Sheet
  rows.push({ label: 'Balance Sheet', classifiedValue: null, finalValue: null, isStatementHeader: true })
  for (const section of bsSections) {
    if (section.header) rows.push({ label: section.header, classifiedValue: null, finalValue: null, isHeader: true })
    for (const field of section.fields) {
      if (field === 'Check') {
        rows.push({ label: 'Check', classifiedValue: null, finalValue: null, isBalanceCheck: true })
        continue
      }
      const rawFinalValue = finalValues.balance_sheet[field] ?? null
      const l2Value = bsLayer2?.values[field] ?? null
      const corrected = correctedFieldNames.has(field)
      rows.push({
        label: field,
        classifiedValue: l2Value !== null ? formatFieldValue(field, l2Value) : null,
        finalValue: rawFinalValue !== null ? formatFieldValue(field, rawFinalValue) : null,
        rawFinalValue,
        corrected,
        flagged: allFlaggedFields.has(field) && !corrected,
        validationFail: bsFailingFields.has(field) && !corrected,
        isBold: BOLD_FIELDS.has(field),
        isIndented: isIndented(field),
        isItalic: ITALIC_FIELDS.has(field),
      })
    }
  }

  // Cash Flow Statement (no validation checks — CFS validation not implemented)
  if (cfsSections.length > 0) {
    rows.push({ label: 'Cash Flow Statement', classifiedValue: null, finalValue: null, isStatementHeader: true })
    for (const section of cfsSections) {
      if (section.header) rows.push({ label: section.header, classifiedValue: null, finalValue: null, isHeader: true })
      for (const field of section.fields) {
        const rawFinalValue = finalValues.cash_flow_statement[field] ?? null
        const l2Value = cfsLayer2?.values[field] ?? null
        const corrected = correctedFieldNames.has(field)
        rows.push({
          label: field,
          classifiedValue: l2Value !== null ? formatFieldValue(field, l2Value) : null,
          finalValue: rawFinalValue !== null ? formatFieldValue(field, rawFinalValue) : null,
          rawFinalValue,
          corrected,
          flagged: allFlaggedFields.has(field) && !corrected,
          validationFail: false,
          isBold: BOLD_FIELDS.has(field),
          isIndented: isIndented(field),
          isItalic: ITALIC_FIELDS.has(field),
        })
      }
    }
  }

  return rows
}
