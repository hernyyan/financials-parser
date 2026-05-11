import { useEffect, useMemo, useState } from 'react'
import { useWizardState } from '../../hooks/useWizardState'
import { useClassification } from '../../hooks/useClassification'
import DataTable from '../shared/DataTable'
import SidePanel from '../shared/SidePanel'
import LoadingSpinner from '../shared/LoadingSpinner'
import StatusBanner from '../shared/StatusBanner'
import { getTemplate } from '../../api/client'
import { IS_TEMPLATE_FIELDS, BS_TEMPLATE_FIELDS } from '../../mocks/mockData'
import { useCorrections } from '../../hooks/useCorrections'
import { buildSourceRows, buildTemplateRows } from '../../utils/classifyRows'
import type { Layer2Result, TemplateResponse, TemplateSection } from '../../types'
import ClassifyActionBar from './ClassifyActionBar'
import ClassifyLoadingView from './ClassifyLoadingView'

type StatusMessage = { type: 'success' | 'error' | 'info'; message: string } | null

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

  const [template, setTemplate] = useState<TemplateResponse | null>(null)
  const [status, setStatus] = useState<StatusMessage>(null)
  const [approvingStep2, setApprovingStep2] = useState(false)

  const isLayer2 = layer2Results['income_statement']
  const bsLayer2 = layer2Results['balance_sheet']
  const cfsLayer2 = layer2Results['cash_flow_statement']

  const hasBothResults =
    !!isLayer2 && !!bsLayer2 && (!layer1Results['cash_flow_statement'] || !!cfsLayer2)

  const {
    stmtStatus,
    stmtError,
    isClassifying,
    elapsedSeconds,
    run: runClassification,
    retry: handleRetry,
    markAllDone,
    STMT_TYPES,
    STMT_LABELS,
  } = useClassification({
    sessionId,
    companyId,
    useCompanyContext,
    layer1Results,
    layer2Results,
    setLayer2Results,
  })

  const hasAnyResults = !!isLayer2 || !!bsLayer2
  const allSettled = Object.values(stmtStatus).every((s) => s !== 'loading')
  const hasAnyError = Object.values(stmtStatus).some((s) => s === 'error')

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
      markAllDone()
      return
    }
    runClassification()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      <ClassifyLoadingView
        stmtTypes={STMT_TYPES}
        stmtStatus={stmtStatus}
        stmtLabels={STMT_LABELS}
        layer1HasCfs={!!layer1Results['cash_flow_statement']}
        elapsedSeconds={elapsedSeconds}
        onBack={backToStep1}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Action bar */}
      <ClassifyActionBar
        hasAnyResults={hasAnyResults}
        isClassifying={isClassifying}
        hasAnyError={hasAnyError}
        approvingStep2={approvingStep2}
        passCount={passCount}
        failCount={failCount}
        flaggedCount={flaggedCount}
        correctionCount={corrections.length}
        onBack={backToStep1}
        onRetry={handleRetry}
        onApprove={handleApproveStep2}
      />

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
