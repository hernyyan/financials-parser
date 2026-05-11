/**
 * useStep3Finalize — owns all state and logic for the Step 3 finalize workflow.
 *
 * Hides:
 *   - template + section resolution (delegated to useTemplate)
 *   - saving / exporting / finalized / finalizedAt / status state
 *   - finalValues assembly (assembleValues) — memoized
 *   - correctedFieldNames Set, allFlaggedFields Set — memoized
 *   - summary stats (totalPopulated, flaggedRemaining) — memoized
 *   - balance sheet check (balanceDiff, isBalanced) — memoized
 *   - rows derivation (buildFinalizeRows) — memoized; failingFields computed inside
 *   - handleFinalize — persists via finalizeOutput, sets finalized/finalizedAt
 *   - handleExportCsv — calls getExport, triggers browser download
 */
import { useState, useMemo } from 'react'
import { finalizeOutput, getExport } from '../api/client'
import { assembleValues } from '../utils/assembleValues'
import { buildFinalizeRows } from '../utils/finalizeRows'
import { useTemplate } from './useTemplate'
import type { FinalizeRow } from '../utils/finalizeRows'
import type { Correction, Layer2Result, StatusMessage } from '../types'

interface UseStep3FinalizeOptions {
  sessionId: string | null
  companyName: string
  reportingPeriod: string
  layer2Results: Record<string, Layer2Result>
  corrections: Correction[]
}

export interface Step3FinalizeData {
  saving: boolean
  exporting: boolean
  finalized: boolean
  finalizedAt: string | null
  status: StatusMessage
  setStatus: (msg: StatusMessage) => void
  rows: FinalizeRow[]
  totalPopulated: number
  flaggedRemaining: number
  isBalanced: boolean
  balanceDiff: number
  handleFinalize: () => Promise<void>
  handleExportCsv: () => Promise<void>
}

export function useStep3Finalize({
  sessionId,
  companyName,
  reportingPeriod,
  layer2Results,
  corrections,
}: UseStep3FinalizeOptions): Step3FinalizeData {
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [status, setStatus] = useState<StatusMessage>(null)
  const [finalized, setFinalized] = useState(false)
  const [finalizedAt, setFinalizedAt] = useState<string | null>(null)

  const { isSections, bsSections, cfsSections } = useTemplate()

  const isLayer2 = layer2Results['income_statement'] ?? null
  const bsLayer2 = layer2Results['balance_sheet'] ?? null
  const cfsLayer2 = layer2Results['cash_flow_statement'] ?? null

  const finalValues = useMemo(
    () => assembleValues(layer2Results, corrections, isSections, cfsSections),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer2Results, corrections, isSections, cfsSections],
  )

  const correctedFieldNames = useMemo(
    () => new Set(corrections.map((c) => c.fieldName)),
    [corrections],
  )

  const allFlaggedFields = useMemo(
    () => new Set([
      ...(isLayer2?.flaggedFields ?? []),
      ...(bsLayer2?.flaggedFields ?? []),
      ...(cfsLayer2?.flaggedFields ?? []),
    ]),
    [isLayer2, bsLayer2, cfsLayer2],
  )

  const totalPopulated = useMemo(
    () => [
      ...Object.values(finalValues.income_statement),
      ...Object.values(finalValues.balance_sheet),
      ...Object.values(finalValues.cash_flow_statement),
    ].filter((v) => v !== null).length,
    [finalValues],
  )

  const flaggedRemaining = useMemo(
    () => [...allFlaggedFields].filter((f) => !correctedFieldNames.has(f)).length,
    [allFlaggedFields, correctedFieldNames],
  )

  const { balanceDiff, isBalanced } = useMemo(() => {
    const totalAssets = finalValues.balance_sheet['Total Assets'] ?? 0
    const totalLE = finalValues.balance_sheet['Total Liabilities and Equity'] ?? 0
    const diff = totalAssets - totalLE
    return { balanceDiff: diff, isBalanced: Math.abs(diff) < 0.01 }
  }, [finalValues])

  const rows = useMemo(
    () => buildFinalizeRows({
      isSections,
      bsSections,
      cfsSections,
      finalValues,
      isLayer2: isLayer2 ?? undefined,
      bsLayer2: bsLayer2 ?? undefined,
      cfsLayer2: cfsLayer2 ?? undefined,
      correctedFieldNames,
      allFlaggedFields,
    }),
    [isSections, bsSections, cfsSections, finalValues, isLayer2, bsLayer2, cfsLayer2, correctedFieldNames, allFlaggedFields],
  )

  async function handleExportCsv() {
    if (!sessionId) return
    setExporting(true)
    try {
      const data = await getExport(sessionId)
      const blob = new Blob([data.csv_content], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${companyName}_${reportingPeriod}.csv`.replace(/\s+/g, '_')
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setStatus({ type: 'error', message: 'Export failed.' })
    } finally {
      setExporting(false)
    }
  }

  async function handleFinalize() {
    setSaving(true)
    setStatus(null)
    try {
      const response = await finalizeOutput({
        sessionId,
        companyName,
        reportingPeriod,
        finalValues,
        corrections,
      })
      setFinalizedAt(response.finalizedAt)
      setFinalized(true)
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save. Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return {
    saving,
    exporting,
    finalized,
    finalizedAt,
    status,
    setStatus,
    rows,
    totalPopulated,
    flaggedRemaining,
    isBalanced,
    balanceDiff,
    handleFinalize,
    handleExportCsv,
  }
}
