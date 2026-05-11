import { useEffect, useState } from 'react'
import { useWizardState } from '../../hooks/useWizardState'
import LoadingSpinner from '../shared/LoadingSpinner'
import { finalizeOutput, getTemplate, getExport } from '../../api/client'
import { IS_TEMPLATE_FIELDS, BS_TEMPLATE_FIELDS } from '../../mocks/mockData'
import { assembleValues } from '../../utils/assembleValues'
import { getFailingFieldNames, buildFinalizeRows } from '../../utils/finalizeRows'
import type { FinalizeRow } from '../../utils/finalizeRows'
import { formatDollar } from '../../utils/formatters'
import FinalizeTable from './FinalizeTable'
import type { TemplateResponse, TemplateSection } from '../../types'
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  RotateCcw,
  Edit3,
  Flag,
  Scale,
  XCircle,
  Loader2,
} from 'lucide-react'

type StatusMessage = { type: 'success' | 'error' | 'info'; message: string } | null

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type TableRow = FinalizeRow

export default function Step3Finalize() {
  const {
    sessionId,
    companyName,
    reportingPeriod,
    layer2Results,
    corrections,
    backToStep2,
    resetWizard,
  } = useWizardState()

  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [status, setStatus] = useState<StatusMessage>(null)
  const [finalized, setFinalized] = useState(false)
  const [finalizedAt, setFinalizedAt] = useState<string | null>(null)
  const [template, setTemplate] = useState<TemplateResponse | null>(null)

  const isLayer2 = layer2Results['income_statement']
  const bsLayer2 = layer2Results['balance_sheet']
  const cfsLayer2 = layer2Results['cash_flow_statement']

  useEffect(() => {
    getTemplate().then(setTemplate).catch(() => {})
  }, [])

  const fallbackIs: TemplateSection[] = [{ header: null, fields: IS_TEMPLATE_FIELDS }]
  const fallbackBs: TemplateSection[] = [{ header: null, fields: BS_TEMPLATE_FIELDS }]
  const isSections: TemplateSection[] = template?.income_statement.sections ?? fallbackIs
  const bsSections: TemplateSection[] = template?.balance_sheet.sections ?? fallbackBs
  const cfsSections: TemplateSection[] = template?.cash_flow_statement?.sections ?? []

  const finalValues = assembleValues(layer2Results, corrections, isSections, cfsSections)
  const correctedFieldNames = new Set(corrections.map((c) => c.fieldName))
  const allFlaggedFields = new Set([
    ...(isLayer2?.flaggedFields ?? []),
    ...(bsLayer2?.flaggedFields ?? []),
    ...(cfsLayer2?.flaggedFields ?? []),
  ])
  const isFailingFields = getFailingFieldNames(isLayer2)
  const bsFailingFields = getFailingFieldNames(bsLayer2)

  // Summary stats
  const totalPopulated = [
    ...Object.values(finalValues.income_statement),
    ...Object.values(finalValues.balance_sheet),
    ...Object.values(finalValues.cash_flow_statement),
  ].filter((v) => v !== null).length

  const flaggedRemaining = [...allFlaggedFields].filter(
    (f) => !correctedFieldNames.has(f),
  ).length

  // Balance sheet check
  const totalAssets = finalValues.balance_sheet['Total Assets'] ?? 0
  const totalLE = finalValues.balance_sheet['Total Liabilities and Equity'] ?? 0
  const balanceDiff = totalAssets - totalLE
  const isBalanced = Math.abs(balanceDiff) < 0.01

  const rows = buildFinalizeRows({
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
        message:
          err instanceof Error ? err.message : 'Failed to save. Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-gray-50/80 shrink-0">
        <button
          onClick={backToStep2}
          disabled={finalized}
          className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Review
        </button>

        <div className="flex-1" />

        {!finalized ? (
          <button
            onClick={handleFinalize}
            disabled={saving}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-1.5 rounded-lg text-[13px] hover:bg-emerald-700 transition-colors disabled:opacity-50"
            style={{ fontWeight: 500 }}
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            {saving ? 'Saving...' : 'Finalize & Save'}
          </button>
        ) : (
          <>
            <span
              className="flex items-center gap-1.5 text-[13px] text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg"
              style={{ fontWeight: 500 }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Finalized
            </span>
            <button
              onClick={handleExportCsv}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg border border-border text-[13px] hover:bg-gray-50 transition-colors disabled:opacity-50"
              style={{ fontWeight: 500 }}
            >
              {exporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              {exporting ? 'Exporting...' : 'Download CSV'}
            </button>
            <button
              onClick={resetWizard}
              className="flex items-center gap-2 bg-primary text-white px-4 py-1.5 rounded-lg text-[13px] hover:bg-primary/90 transition-colors"
              style={{ fontWeight: 500 }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Start New Review
            </button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-auto px-4 py-3">
        {/* Error banner */}
        {status?.type === 'error' && (
          <div className="flex items-center gap-2 mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <XCircle className="w-4 h-4 text-red-500 shrink-0" />
            <p className="text-[13px] text-red-700">{status.message}</p>
          </div>
        )}

        {/* Success banner */}
        {finalized && finalizedAt && (
          <div className="flex items-center gap-2 mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            <div>
              <p className="text-[13px] text-emerald-700" style={{ fontWeight: 500 }}>
                Successfully finalized and saved for {companyName} — {reportingPeriod}
              </p>
              <p className="text-[11px] text-emerald-600">{formatDateTime(finalizedAt)}</p>
            </div>
          </div>
        )}

        {/* Summary stat cards */}
        <div className="grid grid-cols-4 gap-3 mb-3">
          <div className="p-3 rounded-lg border border-border bg-gray-50">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <p className="text-[11px] text-muted-foreground">Fields Populated</p>
            </div>
            <p className="text-[18px]" style={{ fontWeight: 600 }}>{totalPopulated}</p>
          </div>
          <div className="p-3 rounded-lg border border-border bg-gray-50">
            <div className="flex items-center gap-2 mb-1">
              <Edit3 className="w-4 h-4 text-purple-500" />
              <p className="text-[11px] text-muted-foreground">Corrections Made</p>
            </div>
            <p className="text-[18px]" style={{ fontWeight: 600 }}>{corrections.length}</p>
          </div>
          <div className="p-3 rounded-lg border border-border bg-gray-50">
            <div className="flex items-center gap-2 mb-1">
              <Flag className="w-4 h-4 text-amber-500" />
              <p className="text-[11px] text-muted-foreground">Flagged Remaining</p>
            </div>
            <p className="text-[18px]" style={{ fontWeight: 600 }}>{flaggedRemaining}</p>
          </div>
          <div className={`p-3 rounded-lg border ${isBalanced ? 'border-border bg-gray-50' : 'border-red-200 bg-red-50'}`}>
            <div className="flex items-center gap-2 mb-1">
              {isBalanced ? (
                <Scale className="w-4 h-4 text-emerald-500" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500" />
              )}
              <p className="text-[11px] text-muted-foreground">Balance Sheet Balances</p>
            </div>
            <p className="text-[18px]" style={{ fontWeight: 600 }}>{isBalanced ? 'Yes' : 'No'}</p>
          </div>
        </div>

        {/* Output table */}
        <FinalizeTable rows={rows} isBalanced={isBalanced} balanceDiff={balanceDiff} />
      </div>
    </div>
  )
}
