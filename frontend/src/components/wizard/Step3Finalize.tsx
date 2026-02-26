import { useEffect, useState } from 'react'
import { useWizardState } from '../../hooks/useWizardState'
import LoadingSpinner from '../shared/LoadingSpinner'
import StatusBanner from '../shared/StatusBanner'
import { finalizeOutput, getTemplate } from '../../api/client'
import { formatFieldValue, formatDollar } from '../../utils/formatters'
import { IS_TEMPLATE_FIELDS, BS_TEMPLATE_FIELDS } from '../../mocks/mockData'
import type { TemplateResponse, TemplateSection } from '../../types'

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
  value: string | null
  rawValue?: number | null
  isStatementHeader?: boolean
  isHeader?: boolean
  isBalanceCheck?: boolean
  corrected?: boolean
  flagged?: boolean
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

    rows.push({ label: 'Income Statement', value: null, isStatementHeader: true })
    for (const section of isSections) {
      if (section.header) rows.push({ label: section.header, value: null, isHeader: true })
      for (const field of section.fields) {
        const rawValue = finalValues.income_statement[field] ?? null
        const corrected = correctedFieldNames.has(field)
        const flagged = allFlaggedFields.has(field) && !corrected
        rows.push({
          label: field,
          value: rawValue !== null ? formatFieldValue(field, rawValue) : null,
          rawValue,
          corrected,
          flagged,
        })
      }
    }

    rows.push({ label: 'Balance Sheet', value: null, isStatementHeader: true })
    for (const section of bsSections) {
      if (section.header) rows.push({ label: section.header, value: null, isHeader: true })
      for (const field of section.fields) {
        if (field === 'Check') {
          rows.push({ label: 'Check', value: null, isBalanceCheck: true })
          continue
        }
        const rawValue = finalValues.balance_sheet[field] ?? null
        const corrected = correctedFieldNames.has(field)
        const flagged = allFlaggedFields.has(field) && !corrected
        rows.push({
          label: field,
          value: rawValue !== null ? formatFieldValue(field, rawValue) : null,
          rawValue,
          corrected,
          flagged,
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
      setStatus({
        type: 'success',
        message: `Output finalized and saved for ${companyName} — ${reportingPeriod}.`,
      })
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
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Action bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={backToStep2}
          disabled={finalized}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 hover:border-gray-400 px-3 py-1.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← Back to Review
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={resetWizard}
            className="text-sm text-gray-500 hover:text-gray-700 border border-gray-300 hover:border-gray-400 px-3 py-1.5 rounded transition-colors"
          >
            ↩ Start New Review
          </button>
          {!finalized && (
            <button
              onClick={handleFinalize}
              disabled={saving}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm px-5 py-1.5 rounded transition-colors font-medium disabled:opacity-50"
            >
              {saving && <LoadingSpinner size="sm" />}
              {saving ? 'Saving...' : '💾 Finalize & Save'}
            </button>
          )}
        </div>
      </div>

      {/* Status banner */}
      {status && (
        <div className="px-4 pt-2 flex-shrink-0">
          <StatusBanner
            type={status.type}
            message={status.message}
            onDismiss={() => setStatus(null)}
          />
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 py-4">
        {/* Summary panel */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">{companyName || '—'}</h2>
              <p className="text-sm text-gray-500 mt-0.5">{reportingPeriod || '—'}</p>
            </div>
            <div
              className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full ${
                finalized ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-700'
              }`}
            >
              {finalized ? '✅ Finalized' : 'Ready to Finalize'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 mt-4 pt-4 border-t border-gray-100">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                Fields Populated
              </p>
              <p className="text-sm font-semibold text-gray-800">{totalPopulated}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                Corrections Made
              </p>
              <p
                className={`text-sm font-semibold ${
                  corrections.length > 0 ? 'text-blue-600' : 'text-gray-800'
                }`}
              >
                {corrections.length}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                Flags Remaining
              </p>
              <p
                className={`text-sm font-semibold ${
                  flaggedRemaining > 0 ? 'text-amber-600' : 'text-gray-800'
                }`}
              >
                {flaggedRemaining}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                Finalized
              </p>
              <p className="text-sm font-semibold text-gray-800">
                {finalizedAt ? formatDateTime(finalizedAt) : '—'}
              </p>
            </div>
          </div>
        </div>

        {/* Full output table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs financial-table border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide w-[50%]">
                  Field
                </th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wide w-[30%]">
                  Value
                </th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide w-[20%]">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                if (row.isStatementHeader) {
                  return (
                    <tr key={idx} className="bg-gray-700 border-y border-gray-600">
                      <td
                        colSpan={3}
                        className="px-4 py-2 font-bold text-white text-[11px] uppercase tracking-wider"
                      >
                        {row.label}
                      </td>
                    </tr>
                  )
                }

                if (row.isHeader) {
                  return (
                    <tr key={idx} className="bg-gray-100 border-y border-gray-200">
                      <td
                        colSpan={3}
                        className="px-4 py-1.5 font-semibold text-gray-600 uppercase tracking-wide text-[10px]"
                      >
                        {row.label}
                      </td>
                    </tr>
                  )
                }

                if (row.isBalanceCheck) {
                  return (
                    <tr key={idx} className="bg-gray-50 border-b border-gray-200">
                      <td className="px-4 py-1.5 text-gray-600 font-medium text-[11px]">
                        Balance Check
                      </td>
                      <td
                        colSpan={2}
                        className={`px-4 py-1.5 font-medium tabular-nums ${
                          isBalanced ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {isBalanced
                          ? '✅ Balanced'
                          : `❌ Imbalanced — difference: ${formatDollar(balanceDiff)}`}
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr
                    key={idx}
                    className={`border-b border-gray-100 ${
                      row.corrected
                        ? 'bg-blue-50/40'
                        : idx % 2 === 0
                        ? 'bg-white'
                        : 'bg-gray-50/40'
                    }`}
                  >
                    <td className="px-4 py-1.5 text-gray-700">{row.label}</td>
                    <td
                      className={`px-4 py-1.5 text-right tabular-nums font-tabular ${
                        row.value === null || row.value === '—'
                          ? 'text-gray-300'
                          : row.corrected
                          ? 'text-blue-600 font-medium'
                          : row.rawValue !== null &&
                            row.rawValue !== undefined &&
                            row.rawValue < 0
                          ? 'text-red-600'
                          : 'text-gray-900'
                      }`}
                    >
                      {row.value ?? '—'}
                    </td>
                    <td className="px-4 py-1.5">
                      {row.corrected && (
                        <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded uppercase font-semibold">
                          Corrected
                        </span>
                      )}
                      {row.flagged && (
                        <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded uppercase font-semibold">
                          Flagged
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
