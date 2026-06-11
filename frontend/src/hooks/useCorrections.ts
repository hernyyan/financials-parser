/**
 * useCorrections — manages pending live-edit state for Step 2.
 *
 * In the formula-based architecture, manual overrides are handled via
 * setManualOverride in useWizardState. This hook now only manages the
 * pendingValues preview state (live edit before save) and the Correction
 * object lifecycle (for audit trail purposes).
 */
import { useRef, useState } from 'react'
import type { Correction, Layer2Result } from '../types'

interface UseCorrectionsOptions {
  sessionId: string | null
  companyId: number | null
  companyName: string
  reportingPeriod: string
  selectedCellType: 'income_statement' | 'balance_sheet' | 'cash_flow_statement' | null
  layer2Results: Record<string, Layer2Result>
  setLayer2Results: (results: Record<string, Layer2Result>) => void
  corrections: Correction[]
  addCorrection: (c: Correction) => void
  removeCorrection: (fieldName: string) => void
  onStatus?: (msg: { type: 'success' | 'error' | 'info'; message: string }) => void
}

export function useCorrections({
  selectedCellType,
  corrections,
  addCorrection,
  removeCorrection: removeWizardCorrection,
  onStatus,
}: UseCorrectionsOptions) {
  const [pendingValues, setPendingValues] = useState<Record<string, number | null> | null>(null)
  const liveEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function save(correctionData: Omit<Correction, 'timestamp'>) {
    const correction: Correction = { ...correctionData, timestamp: new Date().toISOString() }
    addCorrection(correction)
    setPendingValues(null)
    onStatus?.({ type: 'success', message: `Correction saved for "${correctionData.fieldName}".` })
  }

  function remove(fieldName: string) {
    removeWizardCorrection(fieldName)
    setPendingValues(null)
    onStatus?.({ type: 'info', message: `Correction removed for "${fieldName}".` })
  }

  function liveEdit(fieldName: string, value: number | null, _isOverride: boolean) {
    if (!selectedCellType) return
    if (liveEditTimerRef.current) clearTimeout(liveEditTimerRef.current)
    liveEditTimerRef.current = setTimeout(() => {
      setPendingValues(value !== null ? { [fieldName]: value } : null)
    }, 150)
  }

  function clearPending() {
    setPendingValues(null)
  }

  return { pendingValues, clearPending, save, remove, liveEdit }
}
