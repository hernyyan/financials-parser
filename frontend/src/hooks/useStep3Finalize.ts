/**
 * useStep3Finalize — owns all state and logic for the Step 3 finalize workflow.
 *
 * Hides:
 *   - template state + fetch useEffect (getTemplate)
 *   - saving / exporting / finalized / finalizedAt / status state
 *   - section fallback resolution (isSections / bsSections / cfsSections)
 *   - finalValues assembly (assembleValues)
 *   - correctedFieldNames Set, allFlaggedFields Set
 *   - isFailingFields / bsFailingFields (getFailingFieldNames)
 *   - summary stats (totalPopulated, flaggedRemaining)
 *   - balance sheet check (totalAssets, totalLE, balanceDiff, isBalanced)
 *   - rows derivation (buildFinalizeRows)
 *   - handleFinalize — persists via finalizeOutput, sets finalized/finalizedAt
 *   - handleExportCsv — calls getExport, triggers browser download
 */
import { useEffect, useState } from 'react'
import { finalizeOutput, getExport, getTemplate } from '../api/client'
import { IS_TEMPLATE_FIELDS, BS_TEMPLATE_FIELDS } from '../utils/templateFields'
import { assembleValues } from '../utils/assembleValues'
import { getFailingFieldNames, buildFinalizeRows } from '../utils/finalizeRows'
import type { FinalizeRow } from '../utils/finalizeRows'
import type { Correction, Layer2Result, TemplateResponse, TemplateSection } from '../types'

type StatusMessage = { type: 'success' | 'error' | 'info'; message: string } | null

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
  const [template, setTemplate] = useState<TemplateResponse | null>(null)

  useEffect(() => {
    getTemplate().then(setTemplate).catch(() => {})
  }, [])

  const isLayer2 = layer2Results['income_statement'] ?? null
  const bsLayer2 = layer2Results['balance_sheet'] ?? null
  const cfsLayer2 = layer2Results['cash_flow_statement'] ?? null

  const fallbackIs: TemplateSection[] = [{ header: null, fields: IS_TEMPLATE_FIELDS }]
  const fallbackBs: TemplateSection[] = [{ header: null, fields: BS_TEMPLATE_FIELDS }]
  const isSections = template?.income_statement.sections ?? fallbackIs
  const bsSections = template?.balance_sheet.sections ?? fallbackBs
  const cfsSections = template?.cash_flow_statement?.sections ?? []

  const finalValues = assembleValues(layer2Results, corrections, isSections, cfsSections)
  const correctedFieldNames = new Set(corrections.map((c) => c.fieldName))
  const allFlaggedFields = new Set([
    ...(isLayer2?.flaggedFields ?? []),
    ...(bsLayer2?.flaggedFields ?? []),
    ...(cfsLayer2?.flaggedFields ?? []),
  ])
  const isFailingFields = getFailingFieldNames(isLayer2 ?? undefined)
  const bsFailingFields = getFailingFieldNames(bsLayer2 ?? undefined)

  const totalPopulated = [
    ...Object.values(finalValues.income_statement),
    ...Object.values(finalValues.balance_sheet),
    ...Object.values(finalValues.cash_flow_statement),
  ].filter((v) => v !== null).length

  const flaggedRemaining = [...allFlaggedFields].filter(
    (f) => !correctedFieldNames.has(f),
  ).length

  const totalAssets = finalValues.balance_sheet['Total Assets'] ?? 0
  const totalLE = finalValues.balance_sheet['Total Liabilities and Equity'] ?? 0
  const balanceDiff = totalAssets - totalLE
  const isBalanced = Math.abs(balanceDiff) < 0.01

  const rows = buildFinalizeRows({
    isSections,
    bsSections,
    cfsSections,
    finalValues,
    isLayer2: isLayer2 ?? undefined,
    bsLayer2: bsLayer2 ?? undefined,
    cfsLayer2: cfsLayer2 ?? undefined,
    correctedFieldNames,
    allFlaggedFields,
    isFailingFields,
    bsFailingFields,
  })

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
