import { useEffect, useRef, useState } from 'react'
import { useWizardState } from '../../hooks/useWizardState'
import { useExcelExtraction } from '../../hooks/useExcelExtraction'
import { usePdfExtraction } from '../../hooks/usePdfExtraction'
import { useCompanySelector } from '../../hooks/useCompanySelector'
import TabSelector from '../shared/TabSelector'
import ExcelViewer from '../shared/ExcelViewer'
import PdfPageViewer from '../shared/PdfPageViewer'
import StatusBanner from '../shared/StatusBanner'
import DuplicateCheckModal from '../shared/DuplicateCheckModal'
import Layer1ResultsTable from '../shared/Layer1ResultsTable'
import PdfExtractionPanel from './PdfExtractionPanel'
import ExcelSheetAssignmentPanel from './ExcelSheetAssignmentPanel'
import UploadToolbar from './UploadToolbar'
import TemplateReview from './TemplateReview'
import TemplateDeltaReview from './TemplateDeltaReview'
import {
  getCompanyContextStatus,
  continuePreviousReview,
  appendToCompanyDataset,
} from '../../api/client'
import { API_BASE } from '../../api/client'
import type { Company, CompanyContextStatus } from '../../types'
import { useFileUpload } from '../../hooks/useFileUpload'
import {
  Upload,
  FileSpreadsheet,
} from 'lucide-react'
import approveSfx from '../../assets/approve.mp3'

// Pre-load once at module level so the audio buffer is ready before first click.
const approveAudio = new Audio(approveSfx)
approveAudio.preload = 'auto'
approveAudio.load()

type StatusMessage = { type: 'success' | 'error' | 'info'; message: string } | null

// ── Main component ────────────────────────────────────────────────────────

export default function Step1Upload() {
  const {
    companyName,
    companyId,
    reportingPeriod,
    sessionId,
    uploadedFile,
    sheetNames,
    workbookUrl,
    layer1Results,
    activeSheetTab,
    useCompanyContext,
    uploadFileType,
    pdfPageCount,
    pdfUrl,
    pdfPageAssignments,
    setCompanyName,
    setCompanyId,
    setReportingPeriod,
    setSessionId,
    setUploadedFile,
    setSheetNames,
    setWorkbookUrl,
    setLayer1Results,
    mergeLayer1Result,
    setLayer2Results,
    addCorrection,
    setActiveSheetTab,
    setUseCompanyContext,
    setUploadFileType,
    setPdfPageCount,
    setPdfUrl,
    setPdfPageAssignments,
    approveStep1,
  } = useWizardState()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const splitContainerRef = useRef<HTMLDivElement>(null)

  const [status, setStatus] = useState<StatusMessage>(null)
  const [contextStatus, setContextStatus] = useState<CompanyContextStatus | null>(null)
  const [contextLoading, setContextLoading] = useState(false)

  // Resizable divider — left panel width as percentage
  const [leftPct, setLeftPct] = useState(65)

  // Duplicate-check modal state (shared between Excel and PDF paths)
  const [duplicateCheck, setDuplicateCheck] = useState<{
    exists: boolean
    sessionId: string
    finalizedAt: string | null
  } | null>(null)
  const [pendingExtraction, setPendingExtraction] = useState<
    { type: 'pdf' } | { type: 'global' } | null
  >(null)

  // Excel extraction path
  const {
    assignments,
    setAssignments,
    extractionStatus,
    setExtractionStatus,
    extractionError,
    setExtractionError,
    templateReview,
    setTemplateReview,
    runExtractionInner,
    handleRunExtraction,
    reset: resetExcelExtraction,
  } = useExcelExtraction({
    sessionId,
    reportingPeriod,
    companyName,
    companyId,
    mergeLayer1Result,
    setStatus,
    setDuplicateCheck,
    setPendingExtraction,
  })

  // PDF extraction path
  const {
    pdfActiveTab,
    setPdfActiveTab,
    pdfExtracting,
    handlePdfRunAllInner,
    handlePdfRunAll,
    reset: resetPdfExtraction,
  } = usePdfExtraction({
    sessionId,
    reportingPeriod,
    companyName,
    companyId,
    pdfPageAssignments,
    mergeLayer1Result,
    setStatus,
    setDuplicateCheck,
    setPendingExtraction,
  })

  const {
    uploading,
    isDragOver,
    handleFileChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleReupload,
    handleClearUpload,
  } = useFileUpload({
    companyName,
    companyId,
    reportingPeriod,
    fileInputRef,
    setUploadedFile,
    setSessionId,
    setUploadFileType,
    setLayer1Results,
    setSheetNames,
    setWorkbookUrl,
    setPdfPageCount,
    setPdfUrl,
    setPdfPageAssignments,
    resetExcelExtraction,
    resetPdfExtraction,
    setStatus,
    setContextStatus,
    setContextLoading,
  })

  const hasUpload = uploadFileType === 'excel'
    ? sheetNames.length > 0
    : uploadFileType === 'pdf'
      ? pdfPageCount > 0
      : false

  // Company combobox — state and logic owned by hook
  const {
    comboRef,
    companies,
    companiesLoading,
    comboOpen,
    setComboOpen,
    comboSearch,
    handleSearchChange,
    filteredCompanies,
    fuzzyMatches,
    hasExactMatch,
    creatingCompany,
    handleSelectCompany,
    handleCreateCompany,
  } = useCompanySelector({
    initialName: companyName,
    onSelect: (company: Company) => {
      setCompanyName(company.name)
      setCompanyId(company.id)
      if (hasUpload) {
        setContextLoading(true)
        getCompanyContextStatus(company.id)
          .then(setContextStatus)
          .catch(() => setContextStatus(null))
          .finally(() => setContextLoading(false))
      }
    },
    onClear: () => {
      setCompanyName('')
      setCompanyId(null)
    },
    onError: (msg: string) => setStatus({ type: 'error', message: msg }),
  })

  const activeTab = activeSheetTab || sheetNames[0] || ''

  function handleTabChange(tab: string) {
    setActiveSheetTab(tab)
  }

  const showL1Results =
    extractionStatus === 'done' &&
    (
      layer1Results['income_statement'] ||
      layer1Results['balance_sheet'] ||
      layer1Results['cash_flow_statement']
    )

  const canApprove = !!(
    (
      layer1Results['income_statement'] ||
      layer1Results['balance_sheet'] ||
      layer1Results['cash_flow_statement']
    ) &&
    extractionStatus !== 'running' &&
    !Object.values(pdfExtracting).some(Boolean)
  )

  const extractedSheetNames = sheetNames.filter((s) => {
    for (const [stmtType, tab] of Object.entries(assignments)) {
      if (tab === s && layer1Results[stmtType]) return true
    }
    return false
  })

  const anyAssigned =
    assignments.income_statement !== '' ||
    assignments.balance_sheet !== '' ||
    assignments.cash_flow_statement !== ''

  const canRunExtraction =
    hasUpload &&
    anyAssigned &&
    !!sessionId &&
    reportingPeriod.trim() !== '' &&
    companyName.trim() !== '' &&
    extractionStatus !== 'running'

  // ── Resizable divider ───────────────────────────────────────────────────

  function handleDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    const container = splitContainerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()

    function onMouseMove(ev: MouseEvent) {
      const newPct = ((ev.clientX - containerRect.left) / containerRect.width) * 100
      const minLeft = (300 / containerRect.width) * 100
      const maxLeft = ((containerRect.width - 320) / containerRect.width) * 100
      setLeftPct(Math.min(Math.max(newPct, minLeft), maxLeft))
    }

    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // ── PDF page assignment (stays in parent — writes wizard state) ─────────

  function handlePdfPageClick(pageNumber: number) {
    const current = pdfPageAssignments[pageNumber]
    const newAssignments = { ...pdfPageAssignments }
    if (current === pdfActiveTab) {
      delete newAssignments[pageNumber]
    } else {
      newAssignments[pageNumber] = pdfActiveTab
    }
    setPdfPageAssignments(newAssignments)
  }

  async function handleContinuePrevious() {
    if (!companyId) return
    setDuplicateCheck(null)
    try {
      const data = await continuePreviousReview(companyId, reportingPeriod)

      if (!data.layer1_data || typeof data.layer1_data !== 'object') {
        console.warn('[handleContinuePrevious] layer1_data missing or malformed', data.layer1_data)
      }
      if (data.layer2_data && typeof data.layer2_data !== 'object') {
        console.warn('[handleContinuePrevious] layer2_data malformed', data.layer2_data)
      }

      setSessionId(data.session_id)
      setLayer1Results(data.layer1_data || {})
      if (data.layer2_data) {
        setLayer2Results(data.layer2_data)
      }
      if (data.corrections && Array.isArray(data.corrections)) {
        for (const c of data.corrections) {
          addCorrection({
            fieldName: c.field_name,
            originalValue: c.layer2_value ?? 0,
            correctedValue: c.corrected_value,
            reasoning: c.analyst_reasoning ?? undefined,
            tag: c.tag,
            timestamp: new Date().toISOString(),
          })
        }
      }
      approveStep1()
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to load previous review.',
      })
    }
  }

  function handleOverwrite() {
    setDuplicateCheck(null)
    if (pendingExtraction?.type === 'pdf') {
      handlePdfRunAllInner()
    } else if (pendingExtraction?.type === 'global') {
      runExtractionInner()
    }
    setPendingExtraction(null)
  }

  const placeholderTabs = ['Sheet 1', 'Sheet 2']
  const displayTabs = hasUpload && uploadFileType === 'excel' ? sheetNames : placeholderTabs
  const displayActiveTab = activeTab || displayTabs[0]

  // ── Render ──────────────────────────────────────────────────────────────

  // ── Template review overlay ─────────────────────────────────────────────

  if (templateReview && companyId) {
    if (templateReview.mode === 'new') {
      return (
        <TemplateReview
          structured={templateReview.structured}
          statementType={templateReview.statementType}
          companyId={companyId}
          onSaved={() => setTemplateReview(null)}
          onCancel={() => {
            setTemplateReview(null)
            setExtractionStatus('idle')
            setExtractionError(null)
            setLayer1Results({})
          }}
        />
      )
    }
    if (templateReview.mode === 'delta' && templateReview.unmatchedItems) {
      return (
        <TemplateDeltaReview
          unmatchedItems={templateReview.unmatchedItems}
          statementType={templateReview.statementType}
          companyId={companyId}
          onSaved={() => setTemplateReview(null)}
          onSkip={() => setTemplateReview(null)}
        />
      )
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <UploadToolbar
        comboRef={comboRef}
        comboOpen={comboOpen}
        comboSearch={comboSearch}
        companiesLoading={companiesLoading}
        creatingCompany={creatingCompany}
        filteredCompanies={filteredCompanies}
        fuzzyMatches={fuzzyMatches}
        hasExactMatch={hasExactMatch}
        setComboOpen={setComboOpen}
        onSearchChange={handleSearchChange}
        onSelectCompany={handleSelectCompany}
        onCreateCompany={handleCreateCompany}
        reportingPeriod={reportingPeriod}
        onReportingPeriodChange={setReportingPeriod}
        fileInputRef={fileInputRef}
        uploading={uploading}
        hasUpload={hasUpload}
        uploadedFileName={uploadedFile?.name ?? null}
        onFileChange={handleFileChange}
        onReupload={handleReupload}
        onClearUpload={handleClearUpload}
        useCompanyContext={useCompanyContext}
        contextLoading={contextLoading}
        contextStatus={contextStatus}
        onToggleContext={() => setUseCompanyContext(!useCompanyContext)}
        canApprove={canApprove}
        onApprove={() => {
          if (Math.random() < 0.01) {
            approveAudio.currentTime = 0
            approveAudio.play()
          }
          if (companyName && reportingPeriod && Object.keys(layer1Results).length > 0) {
            appendToCompanyDataset(sessionId, companyName, reportingPeriod, layer1Results)
              .catch((err) => console.error('Dataset append failed:', err))
          }
          approveStep1()
        }}
      />

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

      {/* Split pane */}
      <div ref={splitContainerRef} className="flex flex-1 min-h-0">
        {/* Left: Preview */}
        <div
          className="border-r border-border flex flex-col min-w-0 shrink-0 relative"
          style={{ width: `${leftPct}%` }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div
              className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none"
              style={{
                background: 'rgba(59, 130, 246, 0.08)',
                border: '2px dashed #3b82f6',
                borderRadius: 4,
              }}
            >
              <Upload className="w-10 h-10 text-blue-400 mb-3" />
              <p className="text-[14px] text-blue-600" style={{ fontWeight: 500 }}>
                Drop file to upload
              </p>
              <p className="text-[12px] text-blue-400 mt-1">
                Excel or PDF
              </p>
            </div>
          )}
          {uploadFileType === 'pdf' ? (
            <PdfPageViewer
              pdfUrl={pdfUrl ? `${API_BASE}${pdfUrl}` : null}
              pageCount={pdfPageCount}
              pageAssignments={pdfPageAssignments}
              activeStatementTab={pdfActiveTab}
              onPageClick={handlePdfPageClick}
            />
          ) : (
            <>
              {!showL1Results && (
                <TabSelector
                  tabs={displayTabs}
                  activeTab={displayActiveTab}
                  onChange={handleTabChange}
                  extractedTabs={extractedSheetNames}
                />
              )}
              {!hasUpload ? (
                <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground pt-20">
                  <FileSpreadsheet className="w-12 h-12 mb-3 opacity-30" />
                  <p className="text-[13px]">Upload a file to preview</p>
                </div>
              ) : showL1Results ? (
                <div className="flex-1 overflow-auto p-4 space-y-6">
                  {layer1Results['income_statement'] && (
                    <Layer1ResultsTable result={layer1Results['income_statement']} label="Income Statement" />
                  )}
                  {layer1Results['balance_sheet'] && (
                    <Layer1ResultsTable result={layer1Results['balance_sheet']} label="Balance Sheet" />
                  )}
                  {layer1Results['cash_flow_statement'] && (
                    <Layer1ResultsTable result={layer1Results['cash_flow_statement']} label="Cash Flow Statement" />
                  )}
                </div>
              ) : (
                <ExcelViewer workbookUrl={workbookUrl} activeSheet={activeTab} />
              )}
            </>
          )}
        </div>

        {/* Resizable divider */}
        {uploadFileType !== 'pdf' && (
          <div
            onMouseDown={handleDividerMouseDown}
            className="shrink-0 hover:bg-gray-300 transition-colors"
            style={{ width: 4, cursor: 'col-resize', background: '#e5e7eb' }}
          />
        )}

        {/* Right panel */}
        {uploadFileType === 'pdf' ? (
          <PdfExtractionPanel
            pdfActiveTab={pdfActiveTab}
            pdfPageAssignments={pdfPageAssignments}
            pdfExtracting={pdfExtracting}
            layer1Results={layer1Results}
            onSetActiveTab={setPdfActiveTab}
            onRunAll={handlePdfRunAll}
          />
        ) : (
          <ExcelSheetAssignmentPanel
            sheetNames={sheetNames}
            assignments={assignments}
            extractionStatus={extractionStatus}
            extractionError={extractionError}
            canRunExtraction={canRunExtraction}
            onAssign={(stmtType, tab) => setAssignments((prev) => ({ ...prev, [stmtType]: tab }))}
            onRun={handleRunExtraction}
          />
        )}
      </div>

      {/* Duplicate check modal */}
      {duplicateCheck?.exists && (
        <DuplicateCheckModal
          companyName={companyName}
          reportingPeriod={reportingPeriod}
          finalizedAt={duplicateCheck.finalizedAt}
          onContinue={handleContinuePrevious}
          onOverwrite={handleOverwrite}
          onCancel={() => {
            setDuplicateCheck(null)
            setPendingExtraction(null)
          }}
        />
      )}
    </div>
  )
}
