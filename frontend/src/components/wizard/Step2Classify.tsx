import { useEffect, useRef, useState } from 'react'
import { useWizardState } from '../../hooks/useWizardState'
import DataTable from '../shared/DataTable'
import SidePanel from '../shared/SidePanel'
import LoadingSpinner from '../shared/LoadingSpinner'
import StatusBanner from '../shared/StatusBanner'
import { runLayer2, saveCorrection, getTemplate, processCorrections } from '../../api/client'
import { IS_TEMPLATE_FIELDS, BS_TEMPLATE_FIELDS } from '../../mocks/mockData'
import { formatFieldValue } from '../../utils/formatters'
import type { Correction, Layer2Result, TemplateResponse, TemplateSection, CorrectionProcessItem } from '../../types'

type RunStatus = 'idle' | 'loading' | 'done' | 'error'
type StatusMessage = { type: 'success' | 'error' | 'info'; message: string } | null

function detectSheetType(name: string): 'income_statement' | 'balance_sheet' {
  const lower = name.toLowerCase()
  if (
    lower.includes('income') ||
    lower.includes('p&l') ||
    lower.includes('p_l') ||
    lower.includes('profit') ||
    lower.includes('pnl') ||
    lower.includes('revenue') ||
    lower.includes('i/s') ||
    /[_\- ]is$/i.test(name) ||   // e.g. FiveIron_IS, Company-IS, Statement IS
    /^is$/i.test(name)            // sheet named exactly "IS"
  ) {
    return 'income_statement'
  }
  return 'balance_sheet'
}


function formatSourceValue(value: number): string {
  const abs = Math.abs(value)
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return value < 0 ? `(${formatted})` : formatted
}

function buildSourceRows(layer1Results: Record<string, { lineItems: Record<string, number> }>) {
  type Row = React.ComponentProps<typeof DataTable>['rows'][number]
  const rows: Row[] = []
  for (const [sheetName, result] of Object.entries(layer1Results)) {
    if (!result) continue
    rows.push({ label: sheetName, value: null, isStatementHeader: true })
    for (const [label, value] of Object.entries(result.lineItems)) {
      rows.push({ label, value: formatSourceValue(value) })
    }
  }
  return rows
}

function buildTemplateRows(
  sections: TemplateSection[],
  statementLabel: string,
  layer2: Layer2Result | undefined,
  corrections: Correction[],
  selectedCell: string | null,
) {
  type Row = React.ComponentProps<typeof DataTable>['rows'][number]
  const rows: Row[] = []

  rows.push({ label: statementLabel, value: null, isStatementHeader: true })

  for (const section of sections) {
    if (section.header) {
      rows.push({ label: section.header, value: null, isHeader: true })
    }
    for (const field of section.fields) {
      const correction = corrections.find((c) => c.fieldName === field)
      const rawValue = correction
        ? correction.correctedValue
        : layer2
        ? (layer2.values[field] ?? null)
        : null

      const isFlagged = layer2?.flaggedFields.includes(field) ?? false
      const fieldChecks = layer2?.fieldValidations?.[field] ?? []
      const hasValidationFail = fieldChecks.some(
        (checkName) => layer2?.validation[checkName]?.status === 'FAIL',
      )

      rows.push({
        label: field,
        value: rawValue !== null ? formatFieldValue(field, rawValue) : null,
        isFlagged,
        hasValidationFail,
        isClickable: true,
        isEdited: !!correction,
      })
    }
  }

  return rows
}

function buildFallbackSections(): { is: TemplateSection[]; bs: TemplateSection[] } {
  return {
    is: [{ header: null, fields: IS_TEMPLATE_FIELDS }],
    bs: [{ header: null, fields: BS_TEMPLATE_FIELDS }],
  }
}

export default function Step2Classify() {
  const {
    companyId,
    companyName,
    reportingPeriod,
    sessionId,
    sheetNames,
    layer1Results,
    layer2Results,
    corrections,
    selectedCell,
    sidePanelOpen,
    setLayer2Results,
    addCorrection,
    removeCorrection,
    approveStep2,
    backToStep1,
    setSelectedCell,
    setSidePanelOpen,
  } = useWizardState()

  const [isStatus, setIsStatus] = useState<RunStatus>('idle')
  const [bsStatus, setBsStatus] = useState<RunStatus>('idle')
  const [isError, setIsError] = useState<string | null>(null)
  const [bsError, setBsError] = useState<string | null>(null)
  const [template, setTemplate] = useState<TemplateResponse | null>(null)
  const [status, setStatus] = useState<StatusMessage>(null)
  const [showBackConfirm, setShowBackConfirm] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [approvingStep2, setApprovingStep2] = useState(false)
  const classifyingRef = useRef(false)

  const isLayer2 = layer2Results['income_statement']
  const bsLayer2 = layer2Results['balance_sheet']
  const isClassifying = isStatus === 'loading' || bsStatus === 'loading'

  // Tick elapsed seconds while classification is running
  useEffect(() => {
    if (!isClassifying) {
      setElapsedSeconds(0)
      return
    }
    setElapsedSeconds(0)
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000)
    return () => clearInterval(interval)
  }, [isClassifying])
  const hasBothResults = !!isLayer2 && !!bsLayer2
  const hasAnyError = isStatus === 'error' || bsStatus === 'error'

  useEffect(() => {
    getTemplate().then(setTemplate).catch(() => {})
  }, [])

  // Escape key: close side panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && sidePanelOpen) {
        setSidePanelOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sidePanelOpen, setSidePanelOpen])

  useEffect(() => {
    if (hasBothResults) {
      setIsStatus('done')
      setBsStatus('done')
      return
    }
    runClassification()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function findIsBsSheets() {
    const isSheet = sheetNames.find((s) => detectSheetType(s) === 'income_statement')
    // Exclude the IS sheet when searching for BS; fall back to any remaining sheet
    const bsSheet =
      sheetNames.find((s) => s !== isSheet && detectSheetType(s) === 'balance_sheet') ??
      sheetNames.find((s) => s !== isSheet)
    console.log('[Step2] sheet detection →', { sheetNames, isSheet, bsSheet })
    return { isSheet, bsSheet }
  }

  async function runClassification() {
    if (classifyingRef.current) return
    classifyingRef.current = true
    setIsError(null)
    setBsError(null)
    setStatus(null)

    const { isSheet, bsSheet } = findIsBsSheets()
    const newResults: Record<string, Layer2Result> = { ...layer2Results }
    const tasks: Promise<void>[] = []

    if (isSheet && layer1Results[isSheet] && isStatus !== 'done') {
      setIsStatus('loading')
      tasks.push(
        runLayer2({
          session_id: sessionId,
          statement_type: 'income_statement',
          layer1_data: layer1Results[isSheet].lineItems,
        })
          .then((result) => {
            newResults['income_statement'] = result
            setIsStatus('done')
          })
          .catch((err) => {
            setIsStatus('error')
            setIsError(err instanceof Error ? err.message : 'Income statement classification failed.')
          }),
      )
    } else if (!isSheet || !layer1Results[isSheet]) {
      setIsStatus('done')
    }

    if (bsSheet && layer1Results[bsSheet] && bsStatus !== 'done') {
      setBsStatus('loading')
      tasks.push(
        runLayer2({
          session_id: sessionId,
          statement_type: 'balance_sheet',
          layer1_data: layer1Results[bsSheet].lineItems,
        })
          .then((result) => {
            newResults['balance_sheet'] = result
            setBsStatus('done')
          })
          .catch((err) => {
            setBsStatus('error')
            setBsError(err instanceof Error ? err.message : 'Balance sheet classification failed.')
          }),
      )
    } else if (!bsSheet || !layer1Results[bsSheet]) {
      setBsStatus('done')
    }

    await Promise.allSettled(tasks)

    if (Object.keys(newResults).length > Object.keys(layer2Results).length) {
      setLayer2Results(newResults)
    }
    classifyingRef.current = false
  }

  function handleRetry() {
    classifyingRef.current = false
    runClassification()
  }

  const isAllFields = template?.income_statement.allFields ?? IS_TEMPLATE_FIELDS
  const selectedCellType: 'income_statement' | 'balance_sheet' | null = selectedCell
    ? isAllFields.includes(selectedCell)
      ? 'income_statement'
      : 'balance_sheet'
    : null

  const activeLayer2: Layer2Result | null = selectedCellType
    ? (layer2Results[selectedCellType] ?? null)
    : null

  const { is: fallbackIs, bs: fallbackBs } = buildFallbackSections()
  const isSections = template?.income_statement.sections ?? fallbackIs
  const bsSections = template?.balance_sheet.sections ?? fallbackBs

  const isTemplateRows = buildTemplateRows(isSections, 'Income Statement', isLayer2, corrections, selectedCell)
  const bsTemplateRows = buildTemplateRows(bsSections, 'Balance Sheet', bsLayer2, corrections, selectedCell)
  const templateRows = [...isTemplateRows, ...bsTemplateRows]
  const sourceRows = buildSourceRows(layer1Results)

  const existingCorrection = selectedCell
    ? corrections.find((c) => c.fieldName === selectedCell)
    : undefined

  const allValidation = { ...(isLayer2?.validation ?? {}), ...(bsLayer2?.validation ?? {}) }
  const passCount = Object.values(allValidation).filter((v) => v.status === 'PASS').length
  const failCount = Object.values(allValidation).filter((v) => v.status === 'FAIL').length

  async function handleSaveCorrection(correctionData: Omit<Correction, 'timestamp'>) {
    const correction: Correction = { ...correctionData, timestamp: new Date().toISOString() }
    addCorrection(correction)
    try {
      await saveCorrection({
        sessionId,
        fieldName: correctionData.fieldName,
        statementType: selectedCellType ?? 'income_statement',
        originalValue: correctionData.originalValue,
        correctedValue: correctionData.correctedValue,
        reasoning: correctionData.reasoning,
        tag: correctionData.tag,
      })
    } catch {
      // Non-fatal
    }
    setStatus({ type: 'success', message: `Correction saved for "${correctionData.fieldName}".` })
  }

  function handleRemoveCorrection(fieldName: string) {
    removeCorrection(fieldName)
    setStatus({ type: 'info', message: `Correction removed for "${fieldName}".` })
  }

  async function handleApproveStep2() {
    if (corrections.length > 0) {
      setApprovingStep2(true)
      try {
        const processItems: CorrectionProcessItem[] = corrections.map((c) => {
          const stmtType = isAllFields.includes(c.fieldName) ? 'income_statement' : 'balance_sheet'
          const layer2 = layer2Results[stmtType]
          const valKeys = layer2?.fieldValidations[c.fieldName] ?? []
          const validationStr = valKeys.length > 0
            ? valKeys
                .map((k) => {
                  const chk = layer2?.validation[k]
                  return chk ? `${k}: ${chk.status} — ${chk.details}` : k
                })
                .join('; ')
            : null
          return {
            field_name: c.fieldName,
            statement_type: stmtType,
            layer2_value: layer2?.values[c.fieldName] ?? null,
            layer2_reasoning: layer2?.reasoning[c.fieldName] ?? null,
            layer2_validation: validationStr,
            corrected_value: c.correctedValue,
            analyst_reasoning: c.reasoning,
            tag: c.tag,
          }
        })
        await processCorrections({
          company_id: companyId,
          company_name: companyName,
          period: reportingPeriod,
          corrections: processItems,
        })
      } catch {
        // Non-fatal — proceed regardless
      } finally {
        setApprovingStep2(false)
      }
    }
    approveStep2()
  }

  // Full-page loading view while classification is running
  if (isClassifying && !hasBothResults) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex-shrink-0">
          <button
            onClick={() => setShowBackConfirm(true)}
            className="text-sm text-gray-600 hover:text-gray-800 border border-gray-300 hover:border-gray-400 px-3 py-1.5 rounded transition-colors"
          >
            ← Back to Extraction
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-start pt-16 gap-6">
          <LoadingSpinner size="lg" />
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700">Running AI Classification</p>
            <p className="text-xs text-gray-500 mt-1">
              This may take up to 2 minutes per statement
              {elapsedSeconds > 0 && (
                <span className="ml-1 tabular-nums">— {elapsedSeconds}s elapsed</span>
              )}
            </p>
          </div>
          <div className="text-sm space-y-2">
            <div className="flex items-center gap-2.5">
              {isStatus === 'loading' && <LoadingSpinner size="sm" />}
              {isStatus === 'done' && <span className="text-green-600 font-bold">✓</span>}
              {isStatus === 'error' && <span className="text-red-500 font-bold">✗</span>}
              {isStatus === 'idle' && <span className="w-4 h-4 rounded-full border border-gray-300 inline-block" />}
              <span className={isStatus === 'error' ? 'text-red-600' : 'text-gray-600'}>
                Income Statement
                {isStatus === 'done' && ' — Done'}
                {isStatus === 'error' && ` — ${isError}`}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              {bsStatus === 'loading' && <LoadingSpinner size="sm" />}
              {bsStatus === 'done' && <span className="text-green-600 font-bold">✓</span>}
              {bsStatus === 'error' && <span className="text-red-500 font-bold">✗</span>}
              {bsStatus === 'idle' && <span className="w-4 h-4 rounded-full border border-gray-300 inline-block" />}
              <span className={bsStatus === 'error' ? 'text-red-600' : 'text-gray-600'}>
                Balance Sheet
                {bsStatus === 'done' && ' — Done'}
                {bsStatus === 'error' && ` — ${bsError}`}
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Action bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => setShowBackConfirm(true)}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 hover:border-gray-400 px-3 py-1.5 rounded transition-colors"
        >
          ← Back to Extraction
        </button>

        {showBackConfirm && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded px-3 py-1.5">
            <span className="text-xs text-red-700 font-medium">
              Discard all classification results and corrections?
            </span>
            <button
              onClick={() => { setShowBackConfirm(false); backToStep1() }}
              className="text-xs bg-red-600 text-white px-2.5 py-1 rounded hover:bg-red-700"
            >
              Yes, go back
            </button>
            <button
              onClick={() => setShowBackConfirm(false)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        )}

        {hasBothResults && !showBackConfirm && (
          <div className="flex items-center gap-3 text-xs">
            {passCount > 0 && <span className="text-green-600 font-medium">{passCount} passed</span>}
            {failCount > 0 && <span className="text-red-600 font-medium">{failCount} failed</span>}
            {corrections.length > 0 && (
              <span className="text-blue-600 font-medium">
                {corrections.length} correction{corrections.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {hasAnyError && (
            <button
              onClick={handleRetry}
              className="text-sm border border-blue-400 text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded transition-colors"
            >
              ↺ Retry
            </button>
          )}
          <button
            onClick={handleApproveStep2}
            disabled={!hasBothResults || approvingStep2}
            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-1.5 rounded transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {approvingStep2 ? <LoadingSpinner size="sm" /> : '✓'}{' '}
            {approvingStep2 ? 'Processing...' : 'Approve Loader'}
          </button>
        </div>
      </div>

      {status && (
        <div className="px-4 pt-2 flex-shrink-0">
          <StatusBanner type={status.type} message={status.message} onDismiss={() => setStatus(null)} />
        </div>
      )}

      {/* Main 2-column layout — panel is fixed so we pad-right to prevent overlap */}
      <div
        className="flex flex-1 overflow-hidden divide-x divide-gray-200 transition-[padding-right] duration-200"
        style={{ paddingRight: sidePanelOpen ? '24rem' : 0 }}
      >
        {/* Left: Layer 1 source data */}
        <div
          className="flex flex-col overflow-hidden flex-shrink-0"
          style={{ width: '38%' }}
        >
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex-shrink-0">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
              Source Data
            </p>
          </div>
          {sourceRows.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              No source data available
            </div>
          ) : (
            <DataTable rows={sourceRows} />
          )}
        </div>

        {/* Center: Classified template */}
        <div className="flex flex-col overflow-hidden flex-1">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex-shrink-0 flex items-center justify-between">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
              Template
            </p>
            {hasBothResults && (
              <p className="text-[10px] text-gray-400">Click any row to inspect / correct</p>
            )}
          </div>

          {hasAnyError && !hasBothResults ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm font-medium text-red-600">Classification failed</p>
              {isError && <p className="text-xs text-red-500">Income Statement: {isError}</p>}
              {bsError && <p className="text-xs text-red-500">Balance Sheet: {bsError}</p>}
              <button
                onClick={handleRetry}
                className="mt-2 text-sm bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                Retry Classification
              </button>
            </div>
          ) : !hasBothResults ? (
            <div className="flex-1 flex items-start justify-center pt-12">
              <LoadingSpinner message="Classifying via Claude..." />
            </div>
          ) : (
            <DataTable
              rows={templateRows}
              onCellClick={setSelectedCell}
              selectedCell={selectedCell}
            />
          )}
        </div>

      </div>

      {/* Side panel — fixed to viewport, independent scroll */}
      <SidePanel
        isOpen={sidePanelOpen}
        fieldName={selectedCell}
        statementType={selectedCellType}
        layer2Result={activeLayer2}
        existingCorrection={existingCorrection}
        onClose={() => setSidePanelOpen(false)}
        onSaveCorrection={handleSaveCorrection}
        onRemoveCorrection={handleRemoveCorrection}
      />
    </div>
  )
}
