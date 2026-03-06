import { useEffect, useState } from 'react'
import { useWizardState } from '../../hooks/useWizardState'
import LoadingSpinner from '../shared/LoadingSpinner'
import { finalizeOutput, getTemplate } from '../../api/client'
import { formatFieldValue, formatDollar } from '../../utils/formatters'
import { IS_TEMPLATE_FIELDS, BS_TEMPLATE_FIELDS } from '../../mocks/mockData'
import type { TemplateResponse, TemplateSection } from '../../types'
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  RotateCcw,
  Flag,
  Edit3,
  AlertTriangle,
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

interface TableRow {
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
}

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
  const [status, setStatus] = useState<StatusMessage>(null)
  const [finalized, setFinalized] = useState(false)
  const [finalizedAt, setFinalizedAt] = useState<string | null>(null)
  const [template, setTemplate] = useState<TemplateResponse | null>(null)

  const isLayer2 = layer2Results['income_statement']
  const bsLayer2 = layer2Results['balance_sheet']

  useEffect(() => {
    getTemplate().then(setTemplate).catch(() => {})
  }, [])

  const fallbackIs: TemplateSection[] = [{ header: null, fields: IS_TEMPLATE_FIELDS }]
  const fallbackBs: TemplateSection[] = [{ header: null, fields: BS_TEMPLATE_FIELDS }]
  const isSections: TemplateSection[] = template?.income_statement.sections ?? fallbackIs
  const bsSections: TemplateSection[] = template?.balance_sheet.sections ?? fallbackBs

  // Build final values: Layer 2 base + corrections applied on top
  function buildFinalValues() {
    const isValues: Record<string, number | null> = { ...(isLayer2?.values ?? {}) }
    const bsValues: Record<string, number | null> = { ...(bsLayer2?.values ?? {}) }
    const isFieldNames = new Set(isSections.flatMap((s) => s.fields))

    for (const correction of corrections) {
      if (isFieldNames.has(correction.fieldName)) {
        isValues[correction.fieldName] = correction.correctedValue
      } else {
        bsValues[correction.fieldName] = correction.correctedValue
      }
    }
    return { income_statement: isValues, balance_sheet: bsValues }
  }

  const finalValues = buildFinalValues()
  const correctedFieldNames = new Set(corrections.map((c) => c.fieldName))
  const allFlaggedFields = new Set([
    ...(isLayer2?.flaggedFields ?? []),
    ...(bsLayer2?.flaggedFields ?? []),
  ])
  const allValidationFails = new Set([
    ...Object.entries(isLayer2?.validation ?? {})
      .filter(([, v]) => v.status === 'FAIL')
      .flatMap(([k]) =>
        Object.entries(isLayer2?.fieldValidations ?? {})
          .filter(([, checks]) => checks.includes(k))
          .map(([f]) => f)
      ),
    ...Object.entries(bsLayer2?.validation ?? {})
      .filter(([, v]) => v.status === 'FAIL')
      .flatMap(([k]) =>
        Object.entries(bsLayer2?.fieldValidations ?? {})
          .filter(([, checks]) => checks.includes(k))
          .map(([f]) => f)
      ),
  ])

  // Summary stats
  const totalPopulated = [
    ...Object.values(finalValues.income_statement),
    ...Object.values(finalValues.balance_sheet),
  ].filter((v) => v !== null && v !== 0).length

  const flaggedRemaining = [...allFlaggedFields].filter(
    (f) => !correctedFieldNames.has(f),
  ).length

  // Balance sheet check
  const totalAssets = finalValues.balance_sheet['Total Assets'] ?? 0
  const totalLE = finalValues.balance_sheet['Total Liabilities and Equity'] ?? 0
  const balanceDiff = totalAssets - totalLE
  const isBalanced = Math.abs(balanceDiff) < 0.01

  function buildRows(): TableRow[] {
    const rows: TableRow[] = []

    rows.push({ label: 'Income Statement', classifiedValue: null, finalValue: null, isStatementHeader: true })
    for (const section of isSections) {
      if (section.header) rows.push({ label: section.header, classifiedValue: null, finalValue: null, isHeader: true })
      for (const field of section.fields) {
        const rawFinalValue = finalValues.income_statement[field] ?? null
        const l2Value = isLayer2?.values[field] ?? null
        const corrected = correctedFieldNames.has(field)
        const flagged = allFlaggedFields.has(field) && !corrected
        const validationFail = allValidationFails.has(field) && !corrected
        rows.push({
          label: field,
          classifiedValue: l2Value !== null ? formatFieldValue(field, l2Value) : null,
          finalValue: rawFinalValue !== null ? formatFieldValue(field, rawFinalValue) : null,
          rawFinalValue,
          corrected,
          flagged,
          validationFail,
        })
      }
    }

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
        const flagged = allFlaggedFields.has(field) && !corrected
        const validationFail = allValidationFails.has(field) && !corrected
        rows.push({
          label: field,
          classifiedValue: l2Value !== null ? formatFieldValue(field, l2Value) : null,
          finalValue: rawFinalValue !== null ? formatFieldValue(field, rawFinalValue) : null,
          rawFinalValue,
          corrected,
          flagged,
          validationFail,
        })
      }
    }

    return rows
  }

  const rows = buildRows()

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
        <div className="bg-white border border-border rounded-lg overflow-hidden">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-border sticky top-0 z-10">
                <th className="px-4 py-2 w-8" />
                <th className="px-4 py-2 text-left text-muted-foreground" style={{ fontWeight: 500 }}>
                  Field
                </th>
                <th className="px-4 py-2 text-right text-muted-foreground" style={{ fontWeight: 500 }}>
                  Classified Value
                </th>
                <th className="px-4 py-2 text-right text-muted-foreground" style={{ fontWeight: 500 }}>
                  Final Value
                </th>
                <th className="px-4 py-2 text-left text-muted-foreground w-[120px]" style={{ fontWeight: 500 }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                if (row.isStatementHeader) {
                  return (
                    <tr key={idx} className="bg-blue-50/50 border-b border-border">
                      <td
                        colSpan={5}
                        className="px-4 py-2 text-blue-700 text-[11px] uppercase"
                        style={{ fontWeight: 600, letterSpacing: '0.05em' }}
                      >
                        {row.label}
                      </td>
                    </tr>
                  )
                }

                if (row.isHeader) {
                  return (
                    <tr key={idx} className="bg-gray-50/80 border-b border-gray-200">
                      <td
                        colSpan={5}
                        className="px-4 py-1.5 text-muted-foreground text-[10px] uppercase"
                        style={{ fontWeight: 600, letterSpacing: '0.08em' }}
                      >
                        {row.label}
                      </td>
                    </tr>
                  )
                }

                if (row.isBalanceCheck) {
                  return (
                    <tr key={idx} className="bg-gray-50 border-b border-gray-200">
                      <td className="px-4 py-1.5">
                        {isBalanced ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                        ) : (
                          <XCircle className="w-3 h-3 text-red-500" />
                        )}
                      </td>
                      <td className="px-4 py-1.5 text-muted-foreground" style={{ fontWeight: 500 }}>
                        Balance Check
                      </td>
                      <td
                        colSpan={3}
                        className={`px-4 py-1.5 ${isBalanced ? 'text-emerald-600' : 'text-red-600'}`}
                        style={{ fontWeight: 500 }}
                      >
                        {isBalanced
                          ? 'Balanced'
                          : `Imbalanced — difference: ${formatDollar(balanceDiff)}`}
                      </td>
                    </tr>
                  )
                }

                const rowBg = row.corrected
                  ? 'bg-purple-50/30'
                  : row.flagged
                  ? 'bg-amber-50/30'
                  : row.validationFail
                  ? 'bg-red-50/30'
                  : ''

                const isBold =
                  row.label.includes('Total') ||
                  row.label.includes('Gross') ||
                  row.label.includes('Net') ||
                  row.label === 'EBITDA'

                const isNegFinal =
                  row.rawFinalValue !== null &&
                  row.rawFinalValue !== undefined &&
                  row.rawFinalValue < 0

                return (
                  <tr key={idx} className={`border-b border-gray-100 ${rowBg}`}>
                    <td className="px-4 py-1.5">
                      {row.flagged && <Flag className="w-3 h-3 text-amber-500" />}
                      {row.validationFail && <AlertTriangle className="w-3 h-3 text-red-500" />}
                      {row.corrected && <Edit3 className="w-3 h-3 text-purple-500" />}
                    </td>
                    <td className="px-4 py-1.5" style={{ fontWeight: isBold ? 500 : 400 }}>
                      {row.label}
                    </td>
                    <td
                      className={`px-4 py-1.5 text-right font-mono ${
                        row.classifiedValue === null ? 'text-gray-300' : ''
                      } ${row.corrected ? 'line-through text-muted-foreground' : ''}`}
                    >
                      {row.classifiedValue ?? '—'}
                    </td>
                    <td
                      className={`px-4 py-1.5 text-right font-mono ${
                        row.finalValue === null ? 'text-gray-300' : ''
                      } ${row.corrected ? 'text-purple-700' : ''} ${
                        isNegFinal && !row.corrected ? 'text-red-600' : ''
                      }`}
                      style={{ fontWeight: row.corrected ? 500 : 400 }}
                    >
                      {row.finalValue ?? '—'}
                    </td>
                    <td className="px-4 py-1.5">
                      {row.corrected && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700" style={{ fontWeight: 500 }}>
                          Corrected
                        </span>
                      )}
                      {row.flagged && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" style={{ fontWeight: 500 }}>
                          Flagged
                        </span>
                      )}
                      {row.validationFail && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700" style={{ fontWeight: 500 }}>
                          Validation Fail
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
