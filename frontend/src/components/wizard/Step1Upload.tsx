import { useEffect, useRef, useState } from 'react'
import { useWizardState } from '../../hooks/useWizardState'
import { useExcelExtraction } from '../../hooks/useExcelExtraction'
import { usePdfExtraction } from '../../hooks/usePdfExtraction'
import { useCompanySelector } from '../../hooks/useCompanySelector'
import TabSelector from '../shared/TabSelector'
import ExcelViewer from '../shared/ExcelViewer'
import PdfPageViewer from '../shared/PdfPageViewer'
import StatusBanner from '../shared/StatusBanner'
import CompanyCombobox from '../shared/CompanyCombobox'
import DuplicateCheckModal from '../shared/DuplicateCheckModal'
import ExcelSheetAssignmentPanel from './ExcelSheetAssignmentPanel'
import TemplateReview from './TemplateReview'
import TemplateDeltaReview from './TemplateDeltaReview'
import {
  uploadFile,
  getCompanyContextStatus,
  continuePreviousReview,
  appendToCompanyDataset,
} from '../../api/client'
import { API_BASE } from '../../api/client'
import type { Company, CompanyContextStatus, Layer1Result } from '../../types'
import {
  Upload,
  Loader2,
  FileSpreadsheet,
  CheckCircle2,
  ArrowRight,
  X,
} from 'lucide-react'
import approveSfx from '../../assets/approve.mp3'

// Pre-load once at module level so the audio buffer is ready before first click.
const approveAudio = new Audio(approveSfx)
approveAudio.preload = 'auto'
approveAudio.load()

type StatusMessage = { type: 'success' | 'error' | 'info'; message: string } | null

// ── Helpers ───────────────────────────────────────────────────────────────

function formatLineItemValue(value: number): string {
  if (value === 0) return '—'
  const abs = Math.abs(value)
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return value < 0 ? `(${formatted})` : formatted
}

// Results table used in PDF mode
function Layer1ResultsTable({ result, label }: { result: Layer1Result; label?: string }) {
  return (
    <div>
      {label && (
        <p className="text-[11px] text-muted-foreground mb-1.5" style={{ fontWeight: 600 }}>
          {label}
        </p>
      )}
      <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3 text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
        <span>
          Scaling:{' '}
          <span style={{ fontWeight: 500 }} className="text-foreground">
            {result.sourceScaling}
          </span>
        </span>
        <span>
          Column:{' '}
          <span style={{ fontWeight: 500 }} className="text-foreground">
            {result.columnIdentified}
          </span>
        </span>
        <span>
          Items:{' '}
          <span style={{ fontWeight: 500 }} className="text-foreground">
            {Object.keys(result.lineItems).length}
          </span>
        </span>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-1.5 px-2 text-muted-foreground" style={{ fontWeight: 500 }}>
              Line Item
            </th>
            <th className="text-right py-1.5 px-2 text-muted-foreground" style={{ fontWeight: 500 }}>
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(result.lineItems).map(([label, value], i) => {
            const isBold =
              label.includes('Total') ||
              label.includes('Gross') ||
              label.includes('Net') ||
              label.includes('Operating Income') ||
              label.includes('Pre-Tax')
            return (
              <tr key={i} className={`border-b border-gray-100 ${isBold ? 'bg-gray-50/50' : ''}`}>
                <td className="py-1.5 px-2" style={{ fontWeight: isBold ? 500 : 400 }}>
                  {label}
                </td>
                <td className={`py-1.5 px-2 text-right font-mono ${value < 0 ? 'text-red-600' : ''}`}>
                  {formatLineItemValue(value)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

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

  const [uploading, setUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
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

  // ── File upload ─────────────────────────────────────────────────────────

  async function handleFileUpload(file: File) {
    const isPdf = file.name.toLowerCase().endsWith('.pdf')

    setUploading(true)
    setStatus(null)
    try {
      const response = await uploadFile(file, companyName, reportingPeriod)
      setUploadedFile(file)
      setSessionId(response.sessionId)
      setUploadFileType(response.fileType)
      setLayer1Results({})

      if (response.fileType === 'pdf') {
        setPdfPageCount(response.pdfPageCount ?? 0)
        setPdfUrl(response.pdfUrl ?? null)
        setSheetNames([])
        setWorkbookUrl(null)
        setPdfPageAssignments({})
      } else {
        setSheetNames(response.sheetNames)
        setWorkbookUrl(response.workbookUrl)
        setPdfPageCount(0)
        setPdfUrl(null)
        setPdfPageAssignments({})
        resetExcelExtraction()
      }

      setStatus({
        type: 'success',
        message: isPdf
          ? `Uploaded "${file.name}" — ${response.pdfPageCount} page(s) found. Select pages for each statement.`
          : `Uploaded "${file.name}" — ${response.sheetNames.length} sheet(s) found.`,
      })

      if (companyId) {
        setContextLoading(true)
        getCompanyContextStatus(companyId)
          .then(setContextStatus)
          .catch(() => setContextStatus(null))
          .finally(() => setContextLoading(false))
      }
    } catch (err) {
      setStatus({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Upload failed. Check that the backend is running.',
      })
    } finally {
      setUploading(false)
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await handleFileUpload(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    const name = file.name.toLowerCase()
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.pdf')) {
      setStatus({ type: 'error', message: 'Only Excel (.xlsx, .xls) and PDF files are supported.' })
      return
    }
    handleFileUpload(file)
  }

  function handleReupload() {
    setUploadedFile(null)
    setSessionId(null)
    setSheetNames([])
    setWorkbookUrl(null)
    setLayer1Results({})
    resetExcelExtraction()
    resetPdfExtraction()
    setStatus(null)
    setContextStatus(null)
    setUploadFileType(null)
    setPdfPageCount(0)
    setPdfUrl(null)
    setPdfPageAssignments({})
    setTimeout(() => fileInputRef.current?.click(), 0)
  }

  function handleClearUpload() {
    setUploadedFile(null)
    setSessionId(null)
    setSheetNames([])
    setWorkbookUrl(null)
    setLayer1Results({})
    resetExcelExtraction()
    resetPdfExtraction()
    setStatus(null)
    setContextStatus(null)
    setUploadFileType(null)
    setPdfPageCount(0)
    setPdfUrl(null)
    setPdfPageAssignments({})
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
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-gray-50/80 shrink-0 flex-wrap">
        {/* Company dropdown */}
        <CompanyCombobox
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
        />

        {/* Reporting Period */}
        <input
          className="bg-white border border-border rounded-lg px-3 py-1.5 text-[13px] w-[280px] hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-50 disabled:text-muted-foreground"
          placeholder="Reporting period, e.g. February 2026"
          value={reportingPeriod}
          onChange={(e) => setReportingPeriod(e.target.value)}
        />

        {/* Upload / Re-upload button */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.pdf"
          onChange={handleFileChange}
          className="hidden"
        />

        {!hasUpload ? (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors disabled:opacity-50"
            style={{ backgroundColor: '#030213', color: 'white', fontWeight: 500 }}
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            {uploading ? 'Uploading...' : 'Upload File'}
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleReupload}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
              style={{ fontWeight: 500 }}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              {uploadedFile?.name ?? 'Uploaded file'}
            </button>
            <button
              onClick={handleClearUpload}
              className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
              title="Clear upload"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {hasUpload && (
          <div className="flex items-center gap-2.5 px-2.5 py-1 rounded-lg border border-border bg-white">
            <button
              onClick={() => setUseCompanyContext(!useCompanyContext)}
              className={`relative w-8 h-[18px] rounded-full transition-colors ${
                useCompanyContext ? 'bg-emerald-500' : 'bg-gray-300'
              }`}
            >
              <div
                className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${
                  useCompanyContext ? 'left-[17px]' : 'left-[2px]'
                }`}
              />
            </button>
            <div className="text-[12px]">
              <span style={{ fontWeight: 500 }}>Company Context</span>
              {contextLoading ? (
                <span className="text-muted-foreground ml-1.5">checking...</span>
              ) : contextStatus ? (
                contextStatus.has_rules ? (
                  <span className="text-emerald-600 ml-1.5" style={{ fontWeight: 500 }}>
                    {contextStatus.rule_count} rule{contextStatus.rule_count !== 1 ? 's' : ''} ·{' '}
                    {contextStatus.word_count} words
                  </span>
                ) : (
                  <span className="text-muted-foreground ml-1.5">No rules yet</span>
                )
              ) : null}
            </div>
          </div>
        )}

        <div className="flex-1" />

        {/* Approve button */}
        {canApprove && (
          <button
            onClick={() => {
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
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-1.5 rounded-lg text-[13px] hover:bg-emerald-700 transition-colors"
            style={{ fontWeight: 500 }}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Approve Extraction
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
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
          /* PDF extraction panel */
          <div className="flex-1 flex flex-col min-w-[320px]">
            <div className="px-4 py-2.5 border-b border-border shrink-0">
              <button
                onClick={handlePdfRunAll}
                disabled={
                  Object.keys(pdfPageAssignments).length === 0 ||
                  Object.values(pdfExtracting).some(Boolean)
                }
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[13px] transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#030213', color: 'white', fontWeight: 500 }}
              >
                {Object.values(pdfExtracting).some(Boolean) ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running...</>
                ) : (
                  'Run Extraction'
                )}
              </button>
            </div>

            <TabSelector
              tabs={['Income Statement', 'Balance Sheet', 'Cash Flow Statement']}
              activeTab={
                pdfActiveTab === 'income_statement' ? 'Income Statement'
                  : pdfActiveTab === 'balance_sheet' ? 'Balance Sheet'
                  : 'Cash Flow Statement'
              }
              onChange={(tab) =>
                setPdfActiveTab(
                  tab === 'Income Statement' ? 'income_statement'
                    : tab === 'Balance Sheet' ? 'balance_sheet'
                    : 'cash_flow_statement',
                )
              }
              extractedTabs={[
                ...(layer1Results['income_statement'] ? ['Income Statement'] : []),
                ...(layer1Results['balance_sheet'] ? ['Balance Sheet'] : []),
                ...(layer1Results['cash_flow_statement'] ? ['Cash Flow Statement'] : []),
              ]}
              smallText
            />

            {layer1Results[pdfActiveTab] ? (
              <div className="flex-1 overflow-auto p-4">
                <Layer1ResultsTable result={layer1Results[pdfActiveTab]} />
              </div>
            ) : pdfExtracting[pdfActiveTab] ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#030213' }} />
                <p className="text-[13px] text-muted-foreground">
                  Running AI extraction on selected pages...
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-auto p-4">
                <div className="space-y-3">
                  <p className="text-[12px] text-muted-foreground">
                    Select pages from the PDF that contain the{' '}
                    {pdfActiveTab === 'income_statement' ? 'Income Statement'
                      : pdfActiveTab === 'balance_sheet' ? 'Balance Sheet'
                      : 'Cash Flow Statement'},
                    then click Run Extraction above.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(pdfPageAssignments)
                      .filter(([, type]) => type === pdfActiveTab)
                      .sort(([a], [b]) => parseInt(a) - parseInt(b))
                      .map(([page]) => (
                        <span
                          key={page}
                          className={`px-2 py-0.5 rounded text-[11px] ${
                            pdfActiveTab === 'income_statement'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : pdfActiveTab === 'balance_sheet'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-purple-50 text-purple-700 border border-purple-200'
                          }`}
                          style={{ fontWeight: 500 }}
                        >
                          Page {page}
                        </span>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
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
