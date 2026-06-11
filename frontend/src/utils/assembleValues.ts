import type { Correction, Layer2Result, TemplateSection } from '../types'

/**
 * Merge Layer 2 values with corrections to produce final per-statement values.
 * Corrections are distributed by field membership: IS fields go to income_statement,
 * CFS fields go to cash_flow_statement, everything else to balance_sheet.
 */
export function assembleValues(
  layer2Results: Record<string, Layer2Result>,
  corrections: Correction[],
  isSections: TemplateSection[],
  cfsSections: TemplateSection[],
): {
  income_statement: Record<string, number | null>
  balance_sheet: Record<string, number | null>
  cash_flow_statement: Record<string, number | null>
} {
  // Use formulaValues (new formula-based architecture); fall back to empty
  const isValues: Record<string, number | null> = { ...(layer2Results['income_statement']?.formulaValues ?? {}) }
  const bsValues: Record<string, number | null> = { ...(layer2Results['balance_sheet']?.formulaValues ?? {}) }
  const cfsValues: Record<string, number | null> = { ...(layer2Results['cash_flow_statement']?.formulaValues ?? {}) }

  const isFieldNames = new Set(isSections.flatMap((s) => s.fields))
  const cfsFieldNames = new Set(cfsSections.flatMap((s) => s.fields))

  for (const correction of corrections) {
    if (isFieldNames.has(correction.fieldName)) {
      isValues[correction.fieldName] = correction.correctedValue
    } else if (cfsFieldNames.has(correction.fieldName)) {
      cfsValues[correction.fieldName] = correction.correctedValue
    } else {
      bsValues[correction.fieldName] = correction.correctedValue
    }
  }

  return { income_statement: isValues, balance_sheet: bsValues, cash_flow_statement: cfsValues }
}
