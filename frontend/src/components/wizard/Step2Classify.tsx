import { useEffect, useMemo, useRef, useState } from 'react'
import { useWizardState } from '../../hooks/useWizardState'
import DataTable from '../shared/DataTable'
import SidePanel from '../shared/SidePanel'
import LoadingSpinner from '../shared/LoadingSpinner'
import StatusBanner from '../shared/StatusBanner'
import { runLayer2, getTemplate } from '../../api/client'
import { IS_TEMPLATE_FIELDS, BS_TEMPLATE_FIELDS } from '../../mocks/mockData'
import { formatFieldValue } from '../../utils/formatters'
import { BOLD_FIELDS, ITALIC_FIELDS, isIndented } from '../../utils/templateStyling'
import { useCorrections } from '../../hooks/useCorrections'
import type { Correction, Layer2Result, TemplateResponse, TemplateSection } from '../../types'
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  XCircle,
  Edit3,
  ArrowRight,
  Flag,
} from 'lucide-react'

type RunStatus = 'idle' | 'loading' | 'done' | 'error'
type StmtType = 'income_statement' | 'balance_sheet' | 'cash_flow_statement'
type StatusMessage = { type: 'success' | 'error' | 'info'; message: string } | null

const STMT_TYPES: StmtType[] = ['income_statement', 'balance_sheet', 'cash_flow_statement']
const STMT_LABELS: Record<StmtType, string> = {
  income_statement: 'Income Statement',
  balance_sheet: 'Balance Sheet',
  cash_flow_statement: 'Cash Flow Statement',
}
const INIT_STATUS: Record<StmtType, RunStatus> = {
  income_statement: 'idle',
  balance_sheet: 'idle',
  cash_flow_statement: 'idle',
}
const INIT_ERROR: Record<StmtType, string | null> = {
  income_statement: null,
  balance_sheet: null,
  cash_flow_statement: null,
}

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
  pendingValues: Record<string, number | null> | null,
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
      const isPending = pendingValues !== null
      // Use pending values for live preview (overrides corrections too)
      const rawValue = isPending
        ? (pendingValues[field] ?? null)
        : correction
        ? correction.correctedValue
        : layer2
        ? (layer2.values[field] ?? null)
        : null

      const isFlagged = layer2?.flaggedFields.includes(field) ?? false
      const fieldChecks = layer2?.fieldValidations?.[field] ?? []
      const hasValidationFail = fieldChecks.some(
        (checkName) => layer2?.validation[checkName]?.status === 'FAIL',
      )
      // Highlight the actively-edited field in amber when pending
      const isBeingEdited = isPending && field === selectedCell

      rows.push({
        label: field,
        value: rawValue !== null ? formatFieldValue(field, rawValue) : null,
        isFlagged,
        hasValidationFail,
        isClickable: true,
        isEdited: isBeingEdited ? false : !!correction,
        isPending: isBeingEdited,
        isBold: BOLD_FIELDS.has(field),
        isIndented: isIndented(field),
        isItalic: ITALIC_FIELDS.has(field),
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

  const [stmtStatus, setStmtStatus] = useState<Record<StmtType, RunStatus>>(INIT_STATUS)
  const [stmtError, setStmtError] = useState<Record<StmtType, string | null>>(INIT_ERROR)
  const [template, setTemplate] = useState<TemplateResponse | null>(null)

  function setRunStatus(type: StmtType, s: RunStatus) {
    setStmtStatus(prev => ({ ...prev, [type]: s }))
  }
  function setRunError(type: StmtType, err: string | null) {
    setStmtError(prev => ({ ...prev, [type]: err }))
  }
  const [status, setStatus] = useState<StatusMessage>(null)
  const [showBackConfirm, setShowBackConfirm] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [approvingStep2, setApprovingStep2] = useState(false)
  const classifyingRef = useRef(false)

  const isLayer2 = layer2Results['income_statement']
  const bsLayer2 = layer2Results['balance_sheet']
  const cfsLayer2 = layer2Results['cash_flow_statement']
  const isClassifying = Object.values(stmtStatus).some(s => s === 'loading')

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

  const hasBothResults = !!isLayer2 && !!bsLayer2 &&
    (!layer1Results['cash_flow_statement'] || !!cfsLayer2)
  const hasAnyResults = !!isLayer2 || !!bsLayer2
  const allSettled = Object.values(stmtStatus).every(s => s !== 'loading')
  const hasAnyError = Object.values(stmtStatus).some(s => s === 'error')

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
      setStmtStatus({ income_statement: 'done', balance_sheet: 'done', cash_flow_statement: 'done' })
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
    setStmtError(INIT_ERROR)
    setStatus(null)

    const newResults: Record<string, Layer2Result> = { ...layer2Results }
    const tasks: Promise<void>[] = []

    for (const key of STMT_TYPES) {
      if (layer1Results[key] && stmtStatus[key] !== 'done') {
        setRunStatus(key, 'loading')
        tasks.push(
          runLayer2({
            session_id: sessionId,
            statement_type: key,
            layer1_data: layer1Results[key].lineItems,
            company_id: companyId,
            use_company_context: useCompanyContext,
          })
            .then((result) => {
              newResults[key] = result
              setRunStatus(key, 'done')
            })
            .catch((err) => {
              setRunStatus(key, 'error')
              setRunError(key, err instanceof Error ? err.message : `${STMT_LABELS[key]} classification failed.`)
            }),
        )
      } else if (!layer1Results[key]) {
        setRunStatus(key, 'done')
      }
    }

    console.log('[Step2] waiting for', tasks.length, 'task(s) to settle') // eslint-disable-line no-console
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
    setRunStatus('cash_flow_statement', 'idle')
    runClassification()
  }

  const isAllFields = template?.income_statement.allFields ?? IS_TEMPLATE_FIELDS
  const cfsAllFields = template?.cash_flow_statement?.allFields ?? []

  // Stable field→statement map — computed once per template load, not per cell click.
  // Last-write wins on collision: IS overrides BS/CFS, CFS overrides BS.
  const fieldStatementMap = useMemo<Record<string, 'income_statement' | 'balance_sheet' | 'cash_flow_statement'>>(() => {
    const map: Record<string, 'income_statement' | 'balance_sheet' | 'cash_flow_statement'> = {}
    for (const f of (template?.balance_sheet.allFields ?? BS_TEMPLATE_FIELDS)) map[f] = 'balance_sheet'
    for (const f of (template?.cash_flow_statement?.allFields ?? [])) map[f] = 'cash_flow_statement'
    for (const f of isAllFields) map[f] = 'income_statement'
    return map
  }, [template])

  const selectedCellType: 'income_statement' | 'balance_sheet' | 'cash_flow_statement' | null =
    selectedCell ? (fieldStatementMap[selectedCell] ?? 'balance_sheet') : null

  const {
    pendingValues,
    clearPending,
    save: handleSaveCorrection,
    remove: handleRemoveCorrection,
    liveEdit: handleLiveEdit,
  } = useCorrections({
    sessionId,
    companyId,
    companyName,
    reportingPeriod,
    selectedCellType,
    layer2Results,
    setLayer2Results,
    corrections,
    addCorrection,
    removeCorrection,
    onStatus: setStatus,
  })

  const activeLayer2: Layer2Result | null = selectedCellType
    ? (layer2Results[selectedCellType] ?? null)
    : null

  const { is: fallbackIs, bs: fallbackBs } = buildFallbackSections()
  const isSections = template?.income_statement.sections ?? fallbackIs
  const bsSections = template?.balance_sheet.sections ?? fallbackBs

  const isPending = selectedCellType === 'income_statement' ? pendingValues : null
  const bsPending = selectedCellType === 'balance_sheet' ? pendingValues : null
  const cfsPending = selectedCellType === 'cash_flow_statement' ? pendingValues : null
  const isTemplateRows = buildTemplateRows(isSections, 'Income Statement', isLayer2, corrections, selectedCell, isPending)
  const bsTemplateRows = buildTemplateRows(bsSections, 'Balance Sheet', bsLayer2, corrections, selectedCell, bsPending)
  const cfsSections = template?.cash_flow_statement?.sections ?? []
  const cfsTemplateRows = cfsSections.length > 0
    ? buildTemplateRows(cfsSections, 'Cash Flow Statement', cfsLayer2, corrections, selectedCell, cfsPending)
    : []

  const isData = layer1Results['income_statement']
  const bsData = layer1Results['balance_sheet']
  const cfsData = layer1Results['cash_flow_statement']
  const sourceIsRows = isData ? buildSourceRows({ [isData.sourceSheet]: isData }) : []
  const sourceBsRows = bsData ? buildSourceRows({ [bsData.sourceSheet]: bsData }) : []
  const sourceCfsRows = cfsData ? buildSourceRows({ [cfsData.sourceSheet]: cfsData }) : []

  const existingCorrection = selectedCell
    ? corrections.find((c) => c.fieldName === selectedCell)
    : undefined

  // Compute which source line item labels map to the selected template field
  const relevantSourceLabels: Set<string> = (() => {
    if (!selectedCell || !activeLayer2) return new Set()
    const labels = activeLayer2.sourceLabels?.[selectedCell]
    if (labels && labels.length > 0) return new Set(labels)
    return new Set()
  })()

  const allValidation = { ...(isLayer2?.validation ?? {}), ...(bsLayer2?.validation ?? {}) }
  const passCount = Object.values(allValidation).filter((v) => v.status === 'PASS').length
  const failCount = Object.values(allValidation).filter((v) => v.status === 'FAIL').length
  const flaggedCount = [
    ...(isLayer2?.flaggedFields ?? []),
    ...(bsLayer2?.flaggedFields ?? []),
    ...(cfsLayer2?.flaggedFields ?? []),
  ].length

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
            {STMT_TYPES.filter(key => key !== 'cash_flow_statement' || !!layer1Results['cash_flow_statement']).map(key => (
              <div key={key} className="flex items-center gap-3 p-3 border border-[#e2e8f0]" style={{ backgroundColor: '#f8fafc', borderRadius: '4px' }}>
                {stmtStatus[key] === 'done' ? (
                  <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: '#065f46' }} />
                ) : (
                  <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
                )}
                <div>
                  <p className="text-[13px]" style={{ fontWeight: 500 }}>{STMT_LABELS[key]}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {stmtStatus[key] === 'done' ? 'Classification complete' : 'Classifying line items...'}
                  </p>
                </div>
              </div>
            ))}
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
          <div className="flex items-center gap-3 text-[11px]">
            {passCount > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-[3px] bg-[#d1fae5]" style={{ color: '#065f46', fontWeight: 600 }}>
                <CheckCircle2 className="w-3 h-3" />
                {passCount} passed
              </span>
            )}
            {failCount > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-[3px] bg-[#fee2e2]" style={{ color: '#991b1b', fontWeight: 600 }}>
                <XCircle className="w-3 h-3" />
                {failCount} failed
              </span>
            )}
            {flaggedCount > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-[3px] bg-[#fef3c7]" style={{ color: '#92400e', fontWeight: 600 }}>
                <Flag className="w-3 h-3" />
                {flaggedCount} flagged
              </span>
            )}
            {corrections.length > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-[3px] bg-[#ede9fe]" style={{ color: '#5b21b6', fontWeight: 600 }}>
                <Edit3 className="w-3 h-3" />
                {corrections.length} correction{corrections.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        {hasAnyError && (
          <button
            onClick={handleRetry}
            className="text-[12px] border border-[#e2e8f0] px-3 py-1.5 transition-colors hover:bg-[#f8fafc]"
            style={{ color: '#1a1f35', borderRadius: '4px', fontWeight: 500 }}
          >
            Retry
          </button>
        )}
        <button
          onClick={handleApproveStep2}
          disabled={isClassifying || !hasAnyResults || approvingStep2}
          className="flex items-center gap-2 px-4 py-1.5 text-[12px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontWeight: 600, backgroundColor: '#065f46', color: '#ffffff', borderRadius: '4px' }}
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
            <p style={{ fontSize: 14, fontWeight: 600 }}>
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
                <DataTable rows={sourceIsRows} noScroll stmtHeaderStyle="gray"
                  highlightedLabels={selectedCellType === 'income_statement' ? relevantSourceLabels : undefined} />
                <DataTable rows={sourceBsRows} noScroll stmtHeaderStyle="gray"
                  highlightedLabels={selectedCellType === 'balance_sheet' ? relevantSourceLabels : undefined} />
                <DataTable rows={sourceCfsRows} noScroll stmtHeaderStyle="gray"
                  highlightedLabels={selectedCellType === 'cash_flow_statement' ? relevantSourceLabels : undefined} />
              </>
            )}
          </div>
        </div>

        {/* Right: Classified template */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-gray-50 shrink-0 flex items-center justify-between">
            <p style={{ fontSize: 14, fontWeight: 600 }}>
              Loader Template
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
                {STMT_TYPES.map(key => stmtError[key] ? (
                  <p key={key} className="text-[12px] text-red-500">{STMT_LABELS[key]}: {stmtError[key]}</p>
                ) : null)}
                <button
                  onClick={handleRetry}
                  className="mt-2 text-[12px] border border-[#e2e8f0] px-4 py-2 hover:bg-[#f8fafc] transition-colors"
                  style={{ color: '#1a1f35', borderRadius: '4px', fontWeight: 500 }}
                >
                  Retry Classification
                </button>
              </div>
            ) : (
              <>
                {stmtStatus['income_statement'] === 'loading' ? (
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
                {stmtStatus['balance_sheet'] === 'loading' ? (
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
                {cfsTemplateRows.length > 0 && (
                  <DataTable
                    rows={cfsTemplateRows}
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
          sourceSheet={selectedCellType ? (layer1Results[selectedCellType]?.sourceSheet ?? null) : null}
          onClose={() => { setSidePanelOpen(false); clearPending() }}
          onSaveCorrection={handleSaveCorrection}
          onRemoveCorrection={handleRemoveCorrection}
          onLiveEdit={handleLiveEdit}
        />
      </div>
    </div>
  )
}
