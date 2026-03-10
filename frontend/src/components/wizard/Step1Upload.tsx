import { useEffect, useRef, useState } from 'react'
import { useWizardState } from '../../hooks/useWizardState'
import TabSelector from '../shared/TabSelector'
import ExcelViewer from '../shared/ExcelViewer'
import StatusBanner from '../shared/StatusBanner'
import { uploadFile, runLayer1, getCompanies, createCompany, getCompanyContextStatus } from '../../api/client'
import type { Company, CompanyContextStatus } from '../../types'
import {
  Upload,
  Search,
  ChevronDown,
  Plus,
  Loader2,
  FileSpreadsheet,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react'
import approveSfx from '../../assets/approve.mp3'

// Pre-load once at module level so the audio buffer is ready before first click.
const approveAudio = new Audio(approveSfx)
approveAudio.preload = 'auto'
approveAudio.load()

type SheetType = 'income_statement' | 'balance_sheet'

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
    setCompanyName,
    setCompanyId,
    setReportingPeriod,
    setSessionId,
    setUploadedFile,
    setSheetNames,
    setWorkbookUrl,
    setLayer1Results,
    setActiveSheetTab,
    setUseCompanyContext,
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

  // Company combobox state
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesLoading, setCompaniesLoading] = useState(false)
  const [comboOpen, setComboOpen] = useState(false)
  const [comboSearch, setComboSearch] = useState(companyName)
  const [creatingCompany, setCreatingCompany] = useState(false)

  const hasUpload = sheetNames.length > 0
  const activeTab = activeSheetTab || sheetNames[0] || ''

  // Preserve scroll position per tab when switching tabs.
  function handleTabChange(tab: string) {
    tabScrollPositions.current[activeTab] = tableScrollRef.current?.scrollTop ?? 0
    setActiveSheetTab(tab)

    const destState = tabStates[tab]
    if (destState && destState.status !== 'done') {
      const doneTypes = new Set(
        sheetNames
          .filter((s) => tabStates[s]?.status === 'done')
          .map((s) => tabStates[s].sheetType),
      )
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
  const activeLayer1 = layer1Results[tabStates[activeTab]?.sheetType]

  // Approve requires at least one income statement AND one balance sheet extracted
  const extractedIS = sheetNames.some(
    (s) => tabStates[s]?.status === 'done' && tabStates[s]?.sheetType === 'income_statement',
  )
  const extractedBS = sheetNames.some(
    (s) => tabStates[s]?.status === 'done' && tabStates[s]?.sheetType === 'balance_sheet',
  )
  const canApprove = extractedIS && extractedBS

  const extractedSheetNames = sheetNames.filter((s) => tabStates[s]?.status === 'done')

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!companyName.trim() || !reportingPeriod.trim()) {
      setStatus({
        type: 'error',
        message: 'Please enter company name and reporting period before uploading.',
      })
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setUploading(true)
    setStatus(null)
    try {
      const response = await uploadFile(file, companyName, reportingPeriod)
      setUploadedFile(file)
      setSessionId(response.sessionId)
      setSheetNames(response.sheetNames)
      setWorkbookUrl(response.workbookUrl)
      setLayer1Results({})

      const initialTabStates: Record<string, TabState> = {}
      for (const name of response.sheetNames) {
        initialTabStates[name] = { sheetType: detectSheetType(name), status: 'idle' }
      }
      setTabStates(initialTabStates)

      setStatus({
        type: 'success',
        message: `Uploaded "${file.name}" — ${response.sheetNames.length} sheet(s) found.`,
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
    setTimeout(() => fileInputRef.current?.click(), 0)
  }

  function setTabSheetType(tabName: string, sheetType: SheetType) {
    setTabStates((prev) => ({
      ...prev,
      [tabName]: { ...prev[tabName], sheetType },
    }))
  }

  async function handleRunExtraction(tabName: string) {
    if (!sessionId) return
    const tabState = tabStates[tabName]
    if (!tabState) return

    setTabStates((prev) => ({
      ...prev,
      [tabName]: { ...prev[tabName], status: 'extracting', error: undefined },
    }))
    setStatus(null)

    try {
      const result = await runLayer1(sessionId, tabName, tabState.sheetType, reportingPeriod)
      setLayer1Results({
        ...layer1Results,
        [tabState.sheetType]: {
          lineItems: result.lineItems,
          sourceScaling: result.sourceScaling,
          columnIdentified: result.columnIdentified,
          sourceSheet: tabName,
        },
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

  const placeholderTabs = ['Sheet 1', 'Sheet 2']
  const displayTabs = hasUpload ? sheetNames : placeholderTabs
  const displayActiveTab = activeTab || displayTabs[0]

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-gray-50/80 shrink-0 flex-wrap">
        {/* Company dropdown */}
        <div className="relative" ref={comboRef}>
          <div
            className="flex items-center gap-2 bg-white border border-border rounded-lg px-3 py-1.5 cursor-pointer hover:border-gray-300 min-w-[220px]"
            onClick={() => { if (!hasUpload) setComboOpen(!comboOpen) }}
          >
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              className="bg-transparent outline-none text-[13px] flex-1 min-w-0 disabled:cursor-not-allowed"
              placeholder={companiesLoading ? 'Loading...' : 'Select company...'}
              value={comboSearch}
              disabled={hasUpload || creatingCompany}
              onChange={(e) => {
                setComboSearch(e.target.value)
                setComboOpen(true)
                if (!e.target.value) {
                  setCompanyName('')
                  setCompanyId(null)
                }
              }}
              onFocus={() => { if (!hasUpload) setComboOpen(true) }}
            />
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          </div>
          {comboOpen && !hasUpload && (
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
          disabled={hasUpload}
          onChange={(e) => setReportingPeriod(e.target.value)}
        />

        {/* Upload / Re-upload button */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
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
            {uploading ? 'Uploading...' : 'Upload Excel'}
          </button>
        ) : (
          <button
            onClick={handleReupload}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
            style={{ fontWeight: 500 }}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            {uploadedFile?.name ?? 'Uploaded file'}
          </button>
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
        {/* Left: Excel preview */}
        <div className="flex-[2] border-r border-border flex flex-col min-w-0">
          <TabSelector
            tabs={displayTabs}
            activeTab={displayActiveTab}
            onChange={handleTabChange}
            extractedTabs={extractedSheetNames}
          />
          {!hasUpload ? (
            <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground pt-20">
              <FileSpreadsheet className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-[13px]">Upload an Excel file to preview</p>
            </div>
          ) : (
            <ExcelViewer workbookUrl={workbookUrl} activeSheet={activeTab} />
          )}
        </div>

        {/* Right: Extraction panel */}
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
          ) : activeTabState?.status === 'done' && activeLayer1 ? (
            <div className="flex-1 overflow-auto p-4">
              {/* Metadata bar */}
              <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3 text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                <span>
                  Scaling:{' '}
                  <span style={{ fontWeight: 500 }} className="text-foreground">
                    {activeLayer1.sourceScaling}
                  </span>
                </span>
                <span>
                  Column:{' '}
                  <span style={{ fontWeight: 500 }} className="text-foreground">
                    {activeLayer1.columnIdentified}
                  </span>
                </span>
                <span>
                  Items:{' '}
                  <span style={{ fontWeight: 500 }} className="text-foreground">
                    {Object.keys(activeLayer1.lineItems).length}
                  </span>
                </span>
              </div>
              {/* Extracted items table */}
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
                  {Object.entries(activeLayer1.lineItems).map(([label, value], i) => {
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
      </div>
    </div>
  )
}
