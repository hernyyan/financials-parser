import { useRef, useState } from 'react'
import { saveCorrection as saveCorrectionApi, processCorrections, recalculate } from '../api/client'
import { CALCULATED_FIELDS } from '../utils/templateStyling'
import type { Correction, Layer2Result, StatementType } from '../types'

interface UseCorrectionsOptions {
  sessionId: string | null
  companyId: number | null
  companyName: string
  reportingPeriod: string
  selectedCellType: StatementType | null
  layer2Results: Record<string, Layer2Result>
  setLayer2Results: (results: Record<string, Layer2Result>) => void
  corrections: Correction[]
  addCorrection: (c: Correction) => void
  removeCorrection: (fieldName: string) => void
  onStatus?: (msg: { type: 'success' | 'error' | 'info'; message: string }) => void
}

function buildOverrides(corrections: Correction[]): Record<string, number> {
  const overrides: Record<string, number> = {}
  for (const c of corrections) {
    if (CALCULATED_FIELDS.has(c.fieldName)) {
      overrides[c.fieldName] = c.correctedValue
    }
  }
  return overrides
}

export function useCorrections({
  sessionId,
  companyId,
  companyName,
  reportingPeriod,
  selectedCellType,
  layer2Results,
  setLayer2Results,
  corrections,
  addCorrection,
  removeCorrection: removeWizardCorrection,
  onStatus,
}: UseCorrectionsOptions) {
  const [pendingValues, setPendingValues] = useState<Record<string, number | null> | null>(null)
  const liveEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function save(correctionData: Omit<Correction, 'timestamp'>) {
    const correction: Correction = { ...correctionData, timestamp: new Date().toISOString() }
    setPendingValues(null)

    const stmtType = selectedCellType ?? 'income_statement'

    // 1. Persist to backend first — do not update UI state until confirmed.
    try {
      await saveCorrectionApi({
        sessionId,
        fieldName: correctionData.fieldName,
        statementType: stmtType,
        originalValue: correctionData.originalValue,
        correctedValue: correctionData.correctedValue,
        reasoning: correctionData.reasoning,
        tag: correctionData.tag,
      })
    } catch {
      onStatus?.({ type: 'error', message: `Failed to save correction for "${correctionData.fieldName}". Please try again.` })
      return
    }

    // 2. Save confirmed — update UI state.
    addCorrection(correction)

    // 3. Recalculate display values. Non-fatal: correction is already persisted.
    const currentL2 = layer2Results[stmtType]
    if (currentL2) {
      const baseValues: Record<string, number | null> = { ...currentL2.values }
      const allCorrections = [
        ...corrections.filter((c) => c.fieldName !== correctionData.fieldName),
        correction,
      ]
      for (const c of allCorrections) {
        baseValues[c.fieldName] = c.correctedValue
      }
      try {
        const result = await recalculate(stmtType, baseValues, buildOverrides(allCorrections))
        setLayer2Results({
          ...layer2Results,
          [stmtType]: { ...currentL2, values: result.values },
        })
      } catch {
        // Non-fatal: display values unchanged, but correction is saved.
      }
    }

    // 4. Background AI processing for company_specific / general_fix corrections.
    //    Fire-and-forget but surface failure so the analyst knows to reprocess manually.
    if (correctionData.tag === 'company_specific' || correctionData.tag === 'general_fix') {
      const layer2 = layer2Results[stmtType]
      const valKeys = layer2?.fieldValidations[correctionData.fieldName] ?? []
      const validationStr = valKeys.length > 0
        ? valKeys
            .map((k) => {
              const chk = layer2?.validation[k]
              return chk ? `${k}: ${chk.status} — ${chk.details}` : k
            })
            .join('; ')
        : null

      processCorrections({
        company_id: companyId,
        company_name: companyName,
        period: reportingPeriod,
        corrections: [{
          field_name: correctionData.fieldName,
          statement_type: stmtType,
          layer2_value: layer2?.values[correctionData.fieldName] ?? null,
          layer2_reasoning: layer2?.reasoning[correctionData.fieldName] ?? null,
          layer2_validation: validationStr,
          corrected_value: correctionData.correctedValue,
          analyst_reasoning: correctionData.reasoning,
          tag: correctionData.tag,
        }],
      }).catch(() => {
        onStatus?.({ type: 'error', message: `Correction saved, but background processing failed for "${correctionData.fieldName}".` })
      })
    }

    onStatus?.({ type: 'success', message: `Correction saved for "${correctionData.fieldName}".` })
  }

  async function remove(fieldName: string) {
    removeWizardCorrection(fieldName)
    setPendingValues(null)

    const stmtType = selectedCellType ?? 'income_statement'
    const currentL2 = layer2Results[stmtType]
    if (currentL2) {
      const baseValues: Record<string, number | null> = { ...currentL2.values }
      const allCorrections = corrections.filter((c) => c.fieldName !== fieldName)
      baseValues[fieldName] = currentL2.aiMatchedValues?.[fieldName] ?? currentL2.values[fieldName]
      for (const c of allCorrections) {
        baseValues[c.fieldName] = c.correctedValue
      }
      try {
        const result = await recalculate(stmtType, baseValues, buildOverrides(allCorrections))
        setLayer2Results({
          ...layer2Results,
          [stmtType]: { ...currentL2, values: result.values },
        })
      } catch {
        // Non-fatal
      }
    }

    onStatus?.({ type: 'info', message: `Correction removed for "${fieldName}".` })
  }

  function liveEdit(fieldName: string, value: number | null, isOverride: boolean) {
    if (!selectedCellType) return
    const layer2 = layer2Results[selectedCellType]
    if (!layer2) return

    if (liveEditTimerRef.current) clearTimeout(liveEditTimerRef.current)

    liveEditTimerRef.current = setTimeout(async () => {
      const baseValues: Record<string, number | null> = { ...layer2.values }
      for (const c of corrections) {
        if (c.fieldName in baseValues) {
          baseValues[c.fieldName] = c.correctedValue
        }
      }

      let overrides: Record<string, number> = {}
      if (isOverride && value !== null) {
        overrides = { [fieldName]: value }
      } else {
        baseValues[fieldName] = value
      }

      try {
        const result = await recalculate(selectedCellType, baseValues, overrides)
        setPendingValues(result.values)
      } catch {
        // Non-fatal
      }
    }, 300)
  }

  function clearPending() {
    setPendingValues(null)
  }

  return { pendingValues, clearPending, save, remove, liveEdit }
}
