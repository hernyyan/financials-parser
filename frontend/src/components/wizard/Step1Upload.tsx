import { useEffect, useRef, useState } from 'react'
import { useWizardState } from '../../hooks/useWizardState'
import TabSelector from '../shared/TabSelector'
import ExcelViewer from '../shared/ExcelViewer'
import PdfPageViewer from '../shared/PdfPageViewer'
import StatusBanner from '../shared/StatusBanner'
import { uploadFile, runLayer1, runLayer1Pdf, getCompanies, createCompany, getCompanyContextStatus } from '../../api/client'
import { API_BASE } from '../../api/client'
import type { Company, CompanyContextStatus, Layer1Result } from '../../types'
import {
  Upload,
  Search,
  ChevronDown,
  Plus,
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

type SheetType = 'income_statement' | 'balance_sheet' | 'combined'

interface TabState {
  sheetType: SheetType
  status: 'idle' | 'extracting' | 'done' | 'error'
  error?: string
}

type StatusMessage = { type: 'success' | 'error' | 'info'; message: string } | null

function detectSheetType(name: string): SheetType {
  const lower = name.toLowerCase()
  if (
    lower.includes('income') ||
    lower.includes('p&l') ||
    lower.includes('profit') ||
    lower.includes('pnl') ||
    lower.includes('revenue')
  ) {
    return 'income_statement'
  }
  return 'income_statement'  // default to income_statement for unrecognised names
}

// Format line item values: negatives as (123,456.78), positives as 123,456.78
function formatLineItemValue(value: number): string {
  const abs = Math.abs(value)
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return value < 0 ? `(${formatted})` : formatted
}

// Shared results table used by both Excel and PDF modes
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
    setActiveSheetTab,
    setUseCompanyContext,
    setUploadFileType,
    setPdfPageCount,
    setPdfUrl,
    setPdfPageAssignments,
    approveStep1,
  } = useWizardState()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const tableScrollRef = useRef<HTMLDivElement>(null)
  const tabScrollPositions = useRef<Record<string, number>>({})
  const comboRef = useRef<HTMLDivElement>(null)
  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState<StatusMessage>(null)
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({})
  const [contextStatus, setContextStatus] = useState<CompanyContextStatus | null>(null)
  const [contextLoading, setContextLoading] = useState(false)

  // PDF-specific local state
  const [pdfActiveTab, setPdfActiveTab] = useState<'income_statement' | 'balance_sheet'>('income_statement')
  const [pdfExtracting, setPdfExtracting] = useState<Record<string, boolean>>({})

  // Company combobox state
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesLoading, setCompaniesLoading] = useState(false)
  const [comboOpen, setComboOpen] = useState(false)
  const [comboSearch, setComboSearch] = useState(companyName)
  const [creatingCompany, setCreatingCompany] = useState(false)

  const hasUpload = uploadFileType === 'excel'
    ? sheetNames.length > 0
    : uploadFileType === 'pdf'
      ? pdfPageCount > 0
      : false

  const activeTab = activeSheetTab || sheetNames[0] || ''

  // Preserve scroll position per tab when switching tabs.
  function handleTabChange(tab: string) {
    tabScrollPositions.current[activeTab] = tableScrollRef.current?.scrollTop ?? 0
    setActiveSheetTab(tab)

    const destState = tabStates[tab]
    if (destState && destState.status !== 'done') {
      const doneSheets = sheetNames.filter((s) => tabStates[s]?.status === 'done')
      const doneTypes = new Set<SheetType>()
      for (const s of doneSheets) {
        const t = tabStates[s].sheetType
        if (t === 'combined') {
          doneTypes.add('income_statement')
          doneTypes.add('balance_sheet')
        } else {
          doneTypes.add(t)
        }
      }
      const isOnly = (t: SheetType) => doneTypes.has(t) && !doneTypes.has(t === 'income_statement' ? 'balance_sheet' : 'income_statement')
      if (isOnly('income_statement')) {
        setTabStates((prev) => ({ ...prev, [tab]: { ...prev[tab], sheetType: 'balance_sheet' } }))
      } else if (isOnly('balance_sheet')) {
        setTabStates((prev) => ({ ...prev, [tab]: { ...prev[tab], sheetType: 'income_statement' } }))
      }
    }
  }

  useEffect(() => {
    const pos = tabScrollPositions.current[activeTab] ?? 0
    requestAnimationFrame(() => {
      if (tableScrollRef.current) tableScrollRef.current.scrollTop = pos
    })
  }, [activeTab])

  // Load companies from API on mount
  useEffect(() => {
    setCompaniesLoading(true)
    getCompanies()
      .then(setCompanies)
      .catch(() => {})
      .finally(() => setCompaniesLoading(false))
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredCompanies = companies.filter((c) =>
    c.name.toLowerCase().includes(comboSearch.toLowerCase()),
  )

  function handleSelectCompany(company: Company) {
    setCompanyName(company.name)
    setCompanyId(company.id)
    setComboSearch(company.name)
    setComboOpen(false)
    // Fetch context status if file already uploaded
    if (hasUpload) {
      setContextLoading(true)
      getCompanyContextStatus(company.id)
        .then(setContextStatus)
        .catch(() => setContextStatus(null))
        .finally(() => setContextLoading(false))
    }
  }

  async function handleCreateCompany() {
    const name = comboSearch.trim()
    if (!name) return
    setCreatingCompany(true)
    try {
      const newCompany = await createCompany(name)
      setCompanies((prev) =>
        [...prev, newCompany].sort((a, b) => a.name.localeCompare(b.name)),
      )
      setCompanyName(newCompany.name)
      setCompanyId(newCompany.id)
      setComboSearch(newCompany.name)
      setComboOpen(false)
      setContextStatus({
        company_id: newCompany.id,
        company_name: newCompany.name,
        has_rules: false,
        rule_count: 0,
        word_count: 0,
      })
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to create company.',
      })
    } finally {
      setCreatingCompany(false)
    }
  }

  const activeTabState = tabStates[activeTab]
  const isCombinedTab = activeTabState?.sheetType === 'combined'
  const activeLayer1 = isCombinedTab ? undefined : layer1Results[tabStates[activeTab]?.sheetType]
  const combinedIS = isCombinedTab ? layer1Results['income_statement'] : undefined
  const combinedBS = isCombinedTab ? layer1Results['balance_sheet'] : undefined

  // Approve requires at least one statement extracted
  const extractedIS = uploadFileType === 'pdf'
    ? !!layer1Results['income_statement']
    : sheetNames.some(
        (s) => tabStates[s]?.status === 'done' &&
          (tabStates[s]?.sheetType === 'income_statement' || tabStates[s]?.sheetType === 'combined'),
      )
  const extractedBS = uploadFileType === 'pdf'
    ? !!layer1Results['balance_sheet']
    : sheetNames.some(
        (s) => tabStates[s]?.status === 'done' &&
          (tabStates[s]?.sheetType === 'balance_sheet' || tabStates[s]?.sheetType === 'combined'),
      )
  const canApprove = extractedIS || extractedBS

  const extractedSheetNames = sheetNames.filter((s) => tabStates[s]?.status === 'done')

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

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

        const initialTabStates: Record<string, TabState> = {}
        for (const name of response.sheetNames) {
          initialTabStates[name] = { sheetType: detectSheetType(name), status: 'idle' }
        }
        setTabStates(initialTabStates)
      }

      setStatus({
        type: 'success',
        message: isPdf
          ? `Uploaded "${file.name}" — ${response.pdfPageCount} page(s) found. Select pages for each statement.`
          : `Uploaded "${file.name}" — ${response.sheetNames.length} sheet(s) found.`,
      })

      // Fetch company context status after successful upload
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
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleReupload() {
    setUploadedFile(null)
    setSessionId(null)
    setSheetNames([])
    setWorkbookUrl(null)
    setLayer1Results({})
    setTabStates({})
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
    setTabStates({})
    setStatus(null)
    setContextStatus(null)
    setUploadFileType(null)
    setPdfPageCount(0)
    setPdfUrl(null)
    setPdfPageAssignments({})
  }

  function setTabSheetType(tabName: string, sheetType: SheetType) {
    setTabStates((prev) => ({
      ...prev,
      [tabName]: { ...prev[tabName], sheetType },
    }))
  }

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

  async function handlePdfExtraction() {
    if (!sessionId) return
    if (!reportingPeriod.trim() || !companyName.trim()) {
      setStatus({
        type: 'error',
        message: 'Please enter company name and reporting period before running extraction.',
      })
      return
    }

    const pages = Object.entries(pdfPageAssignments)
      .filter(([, type]) => type === pdfActiveTab)
      .map(([page]) => parseInt(page))
      .sort((a, b) => a - b)

    if (pages.length === 0) {
      setStatus({
        type: 'error',
        message: `No pages selected for ${pdfActiveTab === 'income_statement' ? 'Income Statement' : 'Balance Sheet'}.`,
      })
      return
    }

    setPdfExtracting((prev) => ({ ...prev, [pdfActiveTab]: true }))
    setStatus(null)

    try {
      const result = await runLayer1Pdf(sessionId, pages, pdfActiveTab, reportingPeriod)
      mergeLayer1Result(pdfActiveTab, {
        lineItems: result.lineItems,
        sourceScaling: result.sourceScaling,
        columnIdentified: result.columnIdentified,
        sourceSheet: `PDF pages ${pages.join(', ')}`,
      })
      setPdfExtracting((prev) => ({ ...prev, [pdfActiveTab]: false }))
    } catch (err) {
      setPdfExtracting((prev) => ({ ...prev, [pdfActiveTab]: false }))
      setStatus({
        type: 'error',
        message: `Extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      })
    }
  }

  async function handleRunExtraction(tabName: string) {
    if (!sessionId) return
    if (!reportingPeriod.trim() || !companyName.trim()) {
      setStatus({
        type: 'error',
        message: 'Please enter company name and reporting period before running extraction.',
      })
      return
    }
    const tabState = tabStates[tabName]
    if (!tabState) return

    setTabStates((prev) => ({
      ...prev,
      [tabName]: { ...prev[tabName], status: 'extracting', error: undefined },
    }))
    setStatus(null)

    if (tabState.sheetType === 'combined') {
      const [isResult, bsResult] = await Promise.allSettled([
        runLayer1(sessionId, tabName, 'income_statement', reportingPeriod),
        runLayer1(sessionId, tabName, 'balance_sheet', reportingPeriod),
      ])

      const errors: string[] = []

      if (isResult.status === 'fulfilled') {
        mergeLayer1Result('income_statement', {
          lineItems: isResult.value.lineItems,
          sourceScaling: isResult.value.sourceScaling,
          columnIdentified: isResult.value.columnIdentified,
          sourceSheet: tabName,
        })
      } else {
        errors.push(`IS: ${(isResult.reason as Error)?.message ?? 'failed'}`)
      }

      if (bsResult.status === 'fulfilled') {
        mergeLayer1Result('balance_sheet', {
          lineItems: bsResult.value.lineItems,
          sourceScaling: bsResult.value.sourceScaling,
          columnIdentified: bsResult.value.columnIdentified,
          sourceSheet: tabName,
        })
      } else {
        errors.push(`BS: ${(bsResult.reason as Error)?.message ?? 'failed'}`)
      }

      if (errors.length > 0 && errors.length < 2) {
        setTabStates((prev) => ({
          ...prev,
          [tabName]: { ...prev[tabName], status: 'done' },
        }))
        setStatus({ type: 'info', message: `Partial extraction: ${errors.join('; ')}` })
      } else if (errors.length === 2) {
        setTabStates((prev) => ({
          ...prev,
          [tabName]: { ...prev[tabName], status: 'error', error: errors.join('; ') },
        }))
        setStatus({ type: 'error', message: `Extraction failed: ${errors.join('; ')}` })
      } else {
        setTabStates((prev) => ({
          ...prev,
          [tabName]: { ...prev[tabName], status: 'done' },
        }))
      }
    } else {
      try {
        const result = await runLayer1(sessionId, tabName, tabState.sheetType, reportingPeriod)
        mergeLayer1Result(tabState.sheetType, {
          lineItems: result.lineItems,
          sourceScaling: result.sourceScaling,
          columnIdentified: result.columnIdentified,
          sourceSheet: tabName,
        })
        setTabStates((prev) => ({
          ...prev,
          [tabName]: { ...prev[tabName], status: 'done' },
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Extraction failed.'
        setTabStates((prev) => ({
          ...prev,
          [tabName]: { ...prev[tabName], status: 'error', error: message },
        }))
        setStatus({
          type: 'error',
          message: `Extraction failed for "${tabName}": ${message}`,
        })
      }
    }
  }

  const placeholderTabs = ['Sheet 1', 'Sheet 2']
  const displayTabs = hasUpload && uploadFileType === 'excel' ? sheetNames : placeholderTabs
  const displayActiveTab = activeTab || displayTabs[0]

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-gray-50/80 shrink-0 flex-wrap">
        {/* Company dropdown */}
        <div className="relative" ref={comboRef}>
          <div
            className="flex items-center gap-2 bg-white border border-border rounded-lg px-3 py-1.5 cursor-pointer hover:border-gray-300 min-w-[220px]"
            onClick={() => setComboOpen(!comboOpen)}
          >
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              className="bg-transparent outline-none text-[13px] flex-1 min-w-0 disabled:cursor-not-allowed"
              placeholder={companiesLoading ? 'Loading...' : 'Select company...'}
              value={comboSearch}
              disabled={creatingCompany}
              onChange={(e) => {
                setComboSearch(e.target.value)
                setComboOpen(true)
                if (!e.target.value) {
                  setCompanyName('')
                  setCompanyId(null)
                }
              }}
              onFocus={() => setComboOpen(true)}
            />
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          </div>
          {comboOpen && (
            <div className="absolute top-full left-0 mt-1 w-full bg-white border border-border rounded-lg shadow-lg z-50 max-h-[calc(100vh-120px)] overflow-auto">
              {filteredCompanies.length === 0 && !comboSearch.trim() && (
                <p className="px-3 py-2 text-[12px] text-muted-foreground italic">
                  No companies yet. Type a name to add one.
                </p>
              )}
              {filteredCompanies.map((company) => (
                <div
                  key={company.id}
                  className="px-3 py-2 text-[13px] hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleSelectCompany(company)}
                >
                  {company.name}
                </div>
              ))}
              {comboSearch.trim() &&
                !companies.some(
                  (c) => c.name.toLowerCase() === comboSearch.trim().toLowerCase(),
                ) && (
                  <div
                    className="px-3 py-2 text-[13px] text-blue-600 hover:bg-blue-50 cursor-pointer flex items-center gap-1.5 border-t border-border"
                    onClick={handleCreateCompany}
                  >
                    {creatingCompany ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    {creatingCompany ? 'Creating...' : `Add "${comboSearch.trim()}"`}
                  </div>
                )}
            </div>
          )}
        </div>

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
                    {contextStatus.rule_count} rule{contextStatus.rule_count !== 1 ? 's' : ''} · {contextStatus.word_count} words
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
              if (Math.random() < 0.01) { approveAudio.currentTime = 0; approveAudio.play() }
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
      <div className="flex flex-1 min-h-0">
        {/* Left: Preview */}
        <div className="flex-[2] border-r border-border flex flex-col min-w-0">
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
              <TabSelector
                tabs={displayTabs}
                activeTab={displayActiveTab}
                onChange={handleTabChange}
                extractedTabs={extractedSheetNames}
              />
              {!hasUpload ? (
                <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground pt-20">
                  <FileSpreadsheet className="w-12 h-12 mb-3 opacity-30" />
                  <p className="text-[13px]">Upload a file to preview</p>
                </div>
              ) : (
                <ExcelViewer workbookUrl={workbookUrl} activeSheet={activeTab} />
              )}
            </>
          )}
        </div>

        {/* Right: Extraction panel */}
        {uploadFileType === 'pdf' ? (
          <div className="flex-1 flex flex-col min-w-[320px] max-w-[420px]">
            <TabSelector
              tabs={['Income Statement', 'Balance Sheet']}
              activeTab={pdfActiveTab === 'income_statement' ? 'Income Statement' : 'Balance Sheet'}
              onChange={(tab) => setPdfActiveTab(tab === 'Income Statement' ? 'income_statement' : 'balance_sheet')}
              extractedTabs={[
                ...(layer1Results['income_statement'] ? ['Income Statement'] : []),
                ...(layer1Results['balance_sheet'] ? ['Balance Sheet'] : []),
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
                <div className="space-y-4">
                  <p className="text-[12px] text-muted-foreground">
                    Select pages from the PDF that contain the{' '}
                    {pdfActiveTab === 'income_statement' ? 'Income Statement' : 'Balance Sheet'},
                    then run extraction.
                  </p>

                  {/* Selected page chips */}
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
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                          style={{ fontWeight: 500 }}
                        >
                          Page {page}
                        </span>
                      ))}
                  </div>

                  <button
                    onClick={handlePdfExtraction}
                    disabled={!Object.values(pdfPageAssignments).includes(pdfActiveTab)}
                    className="w-full py-2 rounded-lg text-[13px] transition-colors disabled:opacity-50"
                    style={{ backgroundColor: '#030213', color: 'white', fontWeight: 500 }}
                  >
                    Run Extraction
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-w-[320px] max-w-[420px]">
            <TabSelector
              tabs={displayTabs}
              activeTab={displayActiveTab}
              onChange={handleTabChange}
              extractedTabs={extractedSheetNames}
              smallText
            />

            {!hasUpload ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <p className="text-[13px]">Upload a file to begin extraction</p>
              </div>
            ) : activeTabState?.status === 'done' && (activeLayer1 || isCombinedTab) ? (
              <div className="flex-1 overflow-auto p-4">
                {isCombinedTab ? (
                  <div className="space-y-5">
                    {([
                      { label: 'Income Statement', result: combinedIS },
                      { label: 'Balance Sheet', result: combinedBS },
                    ] as { label: string; result: Layer1Result | undefined }[]).map(
                      ({ label, result }) =>
                        result ? (
                          <Layer1ResultsTable key={label} result={result} label={label} />
                        ) : null,
                    )}
                  </div>
                ) : activeLayer1 ? (
                  <Layer1ResultsTable result={activeLayer1} />
                ) : null}
              </div>
            ) : activeTabState?.status === 'extracting' ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#030213' }} />
                <p className="text-[13px] text-muted-foreground">
                  Running AI extraction on "{activeTab}"...
                </p>
              </div>
            ) : activeTabState?.status === 'error' ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
                <p className="text-[13px] text-red-600" style={{ fontWeight: 500 }}>
                  Extraction failed
                </p>
                <p className="text-[12px] text-red-400 mt-1">{activeTabState.error}</p>
                <button
                  onClick={() => handleRunExtraction(activeTab)}
                  className="mt-3 text-[12px] text-blue-500 hover:text-blue-700 underline"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="flex-1 overflow-auto p-4">
                <div className="space-y-4">
                  <div>
                    <label className="text-[12px] text-muted-foreground block mb-1.5">
                      Statement Type
                    </label>
                    <select
                      value={activeTabState?.sheetType ?? 'income_statement'}
                      onChange={(e) => setTabSheetType(activeTab, e.target.value as SheetType)}
                      disabled={!hasUpload}
                      className="w-full bg-white border border-border rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                    >
                      <option value="income_statement">Income Statement</option>
                      <option value="balance_sheet">Balance Sheet</option>
                      <option value="combined">Both (IS + BS)</option>
                    </select>
                  </div>
                  <button
                    onClick={() => handleRunExtraction(activeTab)}
                    disabled={!hasUpload}
                    className="w-full py-2 rounded-lg text-[13px] transition-colors disabled:opacity-50"
                    style={{ backgroundColor: '#030213', color: 'white', fontWeight: 500 }}
                  >
                    Run Extraction
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
