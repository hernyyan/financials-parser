import { useEffect, useState } from 'react'
import { useWizardState } from '../../hooks/useWizardState'
import { useClassification } from '../../hooks/useClassification'
import { useStep2Classify } from '../../hooks/useStep2Classify'
import { useCorrections } from '../../hooks/useCorrections'
import { buildTemplateRows } from '../../utils/classifyRows'
import DataTable from '../shared/DataTable'
import SidePanel from '../shared/SidePanel'
import LoadingSpinner from '../shared/LoadingSpinner'
import StatusBanner from '../shared/StatusBanner'
import ClassifyActionBar from './ClassifyActionBar'
import ClassifyLoadingView from './ClassifyLoadingView'
import type { StatusMessage } from '../../types'
import { STATEMENT_LABELS } from '../../utils/statementMeta'

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

  const [status, setStatus] = useState<StatusMessage>(null)

  const {
    selectedCellType,
    isLayer2,
    bsLayer2,
    cfsLayer2,
    hasBothResults,
    activeLayer2,
    existingCorrection,
    isSections,
    bsSections,
    cfsSections,
    sourceIsRows,
    sourceBsRows,
    sourceCfsRows,
    relevantSourceLabels,
    passCount,
    failCount,
    flaggedCount,
  } = useStep2Classify({ selectedCell, layer1Results, layer2Results, corrections })

  const {
    stmtStatus,
    stmtError,
    isClassifying,
    elapsedSeconds,
    run: runClassification,
    retry: handleRetry,
    markAllDone,
    ALL_STATEMENT_TYPES,
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

  // Escape key: close side panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && sidePanelOpen) setSidePanelOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sidePanelOpen, setSidePanelOpen])

  useEffect(() => {
    if (hasBothResults) { markAllDone(); return }
    runClassification()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stmtConfigs = [
    { key: 'income_statement'   as const, sections: isSections,   layer2: isLayer2,   sourceRows: sourceIsRows  },
    { key: 'balance_sheet'      as const, sections: bsSections,   layer2: bsLayer2,   sourceRows: sourceBsRows  },
    { key: 'cash_flow_statement' as const, sections: cfsSections, layer2: cfsLayer2,  sourceRows: sourceCfsRows },
  ]

  async function handleApproveStep2() {
    approveStep2()
  }

  // Full-page loading view while classification is running and no results available yet
  if (isClassifying && !hasAnyResults) {
    return (
      <ClassifyLoadingView
        stmtTypes={ALL_STATEMENT_TYPES}
        stmtStatus={stmtStatus}
        stmtLabels={STATEMENT_LABELS}
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
        approvingStep2={false}
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
                {stmtConfigs.map(({ key, sourceRows }) => (
                  <DataTable key={key} rows={sourceRows} noScroll stmtHeaderStyle="gray"
                    highlightedLabels={selectedCellType === key ? relevantSourceLabels : undefined} />
                ))}
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
                {ALL_STATEMENT_TYPES.map(key => stmtError[key] ? (
                  <p key={key} className="text-[12px] text-red-500">{STATEMENT_LABELS[key]}: {stmtError[key]}</p>
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
                {stmtConfigs.map(({ key, sections, layer2 }) => {
                  if (sections.length === 0) return null
                  const pending = selectedCellType === key ? pendingValues : null
                  const rows = buildTemplateRows(sections, STATEMENT_LABELS[key], layer2 ?? undefined, corrections, selectedCell, pending)
                  if (stmtStatus[key] === 'loading') return (
                    <div key={key} className="flex items-center justify-center py-8">
                      <LoadingSpinner size="sm" message={`Classifying ${STATEMENT_LABELS[key]}...`} />
                    </div>
                  )
                  return (
                    <DataTable key={key} rows={rows} noScroll onCellClick={setSelectedCell} selectedCell={selectedCell} />
                  )
                })}
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
