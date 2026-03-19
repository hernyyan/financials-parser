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
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  XCircle,
  Edit3,
  ArrowRight,
} from 'lucide-react'

type RunStatus = 'idle' | 'loading' | 'done' | 'error'
type StatusMessage = { type: 'success' | 'error' | 'info'; message: string } | null

function formatSourceValue(value: number): string {
  if (value === 0) return '—'
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
    layer1Results,
    layer2Results,
    corrections,
    selectedCell,
    sidePanelOpen,
    useCompanyContext,
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
  const hasAnyResults = !!isLayer2 || !!bsLayer2
  const allSettled = isStatus !== 'loading' && bsStatus !== 'loading'
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

  async function runClassification() {
    if (classifyingRef.current) {
      console.warn('[Step2] runClassification: already running, skipping')
      return
    }
    classifyingRef.current = true
    setIsError(null)
    setBsError(null)
    setStatus(null)

    const newResults: Record<string, Layer2Result> = { ...layer2Results }
    const tasks: Promise<void>[] = []

    console.log('[Step2] runClassification start — isStatus:', isStatus, 'bsStatus:', bsStatus, 'layer2Results keys:', Object.keys(layer2Results))

    if (layer1Results['income_statement'] && isStatus !== 'done') {
      console.log('[Step2] IS: queuing task')
      setIsStatus('loading')
      tasks.push(
        runLayer2({
          session_id: sessionId,
          statement_type: 'income_statement',
          layer1_data: layer1Results['income_statement'].lineItems,
          company_id: companyId,
          use_company_context: useCompanyContext,
        })
          .then((result) => {
            console.log('[Step2] IS .then() fired — result truthy:', !!result, 'statementType:', result?.statementType)
            newResults['income_statement'] = result
            console.log('[Step2] IS: calling setIsStatus(done)')
            setIsStatus('done')
          })
          .catch((err) => {
            console.error('[Step2] IS .catch() fired — error:', err)
            setIsStatus('error')
            setIsError(err instanceof Error ? err.message : 'Income statement classification failed.')
          }),
      )
    } else if (!layer1Results['income_statement']) {
      console.log('[Step2] IS: no layer1 data — setting done immediately')
      setIsStatus('done')
    } else {
      console.log('[Step2] IS: skipped (isStatus already done)')
    }

    if (layer1Results['balance_sheet'] && bsStatus !== 'done') {
      console.log('[Step2] BS: queuing task — layer1 lineItems keys:', Object.keys(layer1Results['balance_sheet'].lineItems).length)
      setBsStatus('loading')
      tasks.push(
        runLayer2({
          session_id: sessionId,
          statement_type: 'balance_sheet',
          layer1_data: layer1Results['balance_sheet'].lineItems,
          company_id: companyId,
          use_company_context: useCompanyContext,
        })
          .then((result) => {
            console.log('[Step2] BS .then() fired — result truthy:', !!result, 'statementType:', result?.statementType)
            console.log('[Step2] BS response:', result)
            newResults['balance_sheet'] = result
            console.log('[Step2] BS: calling setBsStatus(done)')
            setBsStatus('done')
            console.log('[Step2] BS: setBsStatus(done) called')
          })
          .catch((err) => {
            console.error('[Step2] BS .catch() fired — error:', err)
            setBsStatus('error')
            setBsError(err instanceof Error ? err.message : 'Balance sheet classification failed.')
          }),
      )
    } else if (!layer1Results['balance_sheet']) {
      console.log('[Step2] BS: no layer1 data — setting done immediately')
      setBsStatus('done')
    } else {
      console.log('[Step2] BS: skipped (bsStatus already done)')
    }

    console.log('[Step2] waiting for', tasks.length, 'task(s) to settle')
    await Promise.allSettled(tasks)
    console.log('[Step2] all tasks settled — newResults keys:', Object.keys(newResults), 'layer2Results keys (closure):', Object.keys(layer2Results))

    if (Object.keys(newResults).length > 0) {
      console.log('[Step2] calling setLayer2Results with keys:', Object.keys(newResults))
      setLayer2Results(newResults)
    } else {
      console.warn('[Step2] no results to persist — both tasks failed or skipped with no prior data')
    }
    classifyingRef.current = false
    console.log('[Step2] runClassification complete')
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

  const isData = layer1Results['income_statement']
  const bsData = layer1Results['balance_sheet']
  const sourceIsRows = isData ? buildSourceRows({ [isData.sourceSheet]: isData }) : []
  const sourceBsRows = bsData ? buildSourceRows({ [bsData.sourceSheet]: bsData }) : []

  const existingCorrection = selectedCell
    ? corrections.find((c) => c.fieldName === selectedCell)
    : undefined

  const allValidation = { ...(isLayer2?.validation ?? {}), ...(bsLayer2?.validation ?? {}) }
  const passCount = Object.values(allValidation).filter((v) => v.status === 'PASS').length
  const failCount = Object.values(allValidation).filter((v) => v.status === 'FAIL').length

  async function handleSaveCorrection(correctionData: Omit<Correction, 'timestamp'>) {
    const correction: Correction = { ...correctionData, timestamp: new Date().toISOString() }
    addCorrection(correction)

    // 1. Save correction to reviews table
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

    // 2. Immediately route if tag needs processing
    if (correctionData.tag === 'company_specific' || correctionData.tag === 'general_fix') {
      const stmtType = selectedCellType ?? 'income_statement'
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
      }).catch((err) => {
        console.error(`Correction processing failed for "${correctionData.fieldName}":`, err)
      })
    }

    setStatus({ type: 'success', message: `Correction saved for "${correctionData.fieldName}".` })
  }

  function handleRemoveCorrection(fieldName: string) {
    removeCorrection(fieldName)
    setStatus({ type: 'info', message: `Correction removed for "${fieldName}".` })
  }

  async function handleApproveStep2() {
    approveStep2()
  }

  // Full-page loading view while classification is running and no results available yet
  if (isClassifying && !hasAnyResults) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center px-4 py-2.5 border-b border-border bg-gray-50/80 shrink-0">
          <button
            onClick={backToStep1}
            className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Extraction
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center pt-20">
          <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
          <h2 className="text-[16px] mb-1" style={{ fontWeight: 600 }}>Classifying Financial Data</h2>
          <p className="text-[13px] text-muted-foreground mb-6">{elapsedSeconds}s elapsed</p>
          <div className="w-[300px] space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-border">
              {isStatus === 'done' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              ) : (
                <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
              )}
              <div>
                <p className="text-[13px]" style={{ fontWeight: 500 }}>Income Statement</p>
                <p className="text-[11px] text-muted-foreground">
                  {isStatus === 'done' ? 'Classification complete' : 'Classifying line items...'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-border">
              {bsStatus === 'done' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              ) : (
                <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
              )}
              <div>
                <p className="text-[13px]" style={{ fontWeight: 500 }}>Balance Sheet</p>
                <p className="text-[11px] text-muted-foreground">
                  {bsStatus === 'done' ? 'Classification complete' : 'Classifying line items...'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Action bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-gray-50/80 shrink-0">
        <button
          onClick={() => setShowBackConfirm(true)}
          className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Extraction
        </button>

        {showBackConfirm && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
            <span className="text-[12px] text-red-700" style={{ fontWeight: 500 }}>
              Discard all classification results and corrections?
            </span>
            <button
              onClick={() => { setShowBackConfirm(false); backToStep1() }}
              className="text-[12px] bg-red-600 text-white px-2.5 py-1 rounded-lg hover:bg-red-700"
            >
              Yes, go back
            </button>
            <button
              onClick={() => setShowBackConfirm(false)}
              className="text-[12px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}

        <div className="flex-1" />

        {hasAnyResults && !isClassifying && !showBackConfirm && (
          <div className="flex items-center gap-3 text-[12px]">
            {passCount > 0 && (
              <span className="flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {passCount} passed
              </span>
            )}
            {failCount > 0 && (
              <span className="flex items-center gap-1 text-red-500">
                <XCircle className="w-3.5 h-3.5" />
                {failCount} failed
              </span>
            )}
            {corrections.length > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <Edit3 className="w-3.5 h-3.5" />
                {corrections.length} correction{corrections.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        {hasAnyError && (
          <button
            onClick={handleRetry}
            className="text-[13px] border border-blue-400 text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            Retry
          </button>
        )}
        <button
          onClick={handleApproveStep2}
          disabled={isClassifying || !hasAnyResults || approvingStep2}
          className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-1.5 rounded-lg text-[13px] hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontWeight: 500 }}
        >
          {approvingStep2 ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" />
          )}
          {approvingStep2 ? 'Processing...' : 'Approve Classification'}
          {!approvingStep2 && <ArrowRight className="w-3.5 h-3.5" />}
        </button>
      </div>

      {status && (
        <div className="px-4 pt-2 flex-shrink-0">
          <StatusBanner type={status.type} message={status.message} onDismiss={() => setStatus(null)} />
        </div>
      )}

      {/* Main layout — horizontal flex with inline side panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden divide-x divide-border">
        {/* Left: Layer 1 source data */}
        <div
          className="flex flex-col flex-shrink-0 min-h-0 overflow-hidden transition-all duration-200"
          style={{ width: sidePanelOpen ? '28%' : '38%' }}
        >
          <div className="px-4 py-2 border-b border-border bg-gray-50 shrink-0">
            <p className="text-[12px] text-muted-foreground" style={{ fontWeight: 500 }}>
              Source Data (Extracted)
            </p>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {sourceIsRows.length === 0 && sourceBsRows.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-[13px]">
                No source data available
              </div>
            ) : (
              <>
                <DataTable rows={sourceIsRows} noScroll stmtHeaderStyle="gray" />
                <DataTable rows={sourceBsRows} noScroll stmtHeaderStyle="gray" />
              </>
            )}
          </div>
        </div>

        {/* Right: Classified template */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-gray-50 shrink-0 flex items-center justify-between">
            <p className="text-[12px] text-muted-foreground" style={{ fontWeight: 500 }}>
              Classified Template
            </p>
            {hasAnyResults && !isClassifying && (
              <p className="text-[11px] text-muted-foreground">Click any row to inspect / correct</p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {!hasAnyResults && !allSettled ? (
              <div className="flex items-start justify-center pt-12">
                <LoadingSpinner message="Classifying via Claude..." />
              </div>
            ) : !hasAnyResults && hasAnyError ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
                <p className="text-[13px] text-red-600" style={{ fontWeight: 500 }}>Classification failed</p>
                {isError && <p className="text-[12px] text-red-500">Income Statement: {isError}</p>}
                {bsError && <p className="text-[12px] text-red-500">Balance Sheet: {bsError}</p>}
                <button
                  onClick={handleRetry}
                  className="mt-2 text-[13px] bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                  Retry Classification
                </button>
              </div>
            ) : (
              <>
                {isStatus === 'loading' ? (
                  <div className="flex items-center justify-center py-8">
                    <LoadingSpinner size="sm" message="Classifying Income Statement..." />
                  </div>
                ) : (
                  <DataTable
                    rows={isTemplateRows}
                    noScroll
                    onCellClick={setSelectedCell}
                    selectedCell={selectedCell}
                  />
                )}
                {bsStatus === 'loading' ? (
                  <div className="flex items-center justify-center py-8">
                    <LoadingSpinner size="sm" message="Classifying Balance Sheet..." />
                  </div>
                ) : (
                  <DataTable
                    rows={bsTemplateRows}
                    noScroll
                    onCellClick={setSelectedCell}
                    selectedCell={selectedCell}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* Inline side panel */}
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
    </div>
  )
}
