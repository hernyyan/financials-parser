import { useEffect, useRef, useState } from 'react'
import { useWizardState } from '../../hooks/useWizardState'
import SplitPane from '../layout/SplitPane'
import TabSelector from '../shared/TabSelector'
import ExcelViewer from '../shared/ExcelViewer'
import DataTable from '../shared/DataTable'
import LoadingSpinner from '../shared/LoadingSpinner'
import StatusBanner from '../shared/StatusBanner'
import { uploadFile, runLayer1, getCompanies, createCompany } from '../../api/client'
import type { Company } from '../../types'
import approveSfx from '../../assets/approve.mp3'

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
    reportingPeriod,
    sessionId,
    uploadedFile,
    sheetNames,
    workbookUrl,
    layer1Results,
    activeSheetTab,
    setCompanyName,
    setCompanyId,
    setReportingPeriod,
    setSessionId,
    setUploadedFile,
    setSheetNames,
    setWorkbookUrl,
    setLayer1Results,
    setActiveSheetTab,
    approveStep1,
    loadMockStep2,
  } = useWizardState()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const tableScrollRef = useRef<HTMLDivElement>(null)
  const tabScrollPositions = useRef<Record<string, number>>({})
  const comboRef = useRef<HTMLDivElement>(null)
  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState<StatusMessage>(null)
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({})

  // Company combobox state
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesLoading, setCompaniesLoading] = useState(false)
  const [comboOpen, setComboOpen] = useState(false)
  const [comboSearch, setComboSearch] = useState(companyName)
  const [creatingCompany, setCreatingCompany] = useState(false)

  const hasUpload = sheetNames.length > 0
  const activeTab = activeSheetTab || sheetNames[0] || ''

  // Preserve scroll position per tab when switching tabs.
  // If the destination tab hasn't been extracted yet, auto-set its sheet type
  // to whichever statement type is still missing (income_statement / balance_sheet).
  // If both are already extracted, or neither, leave the existing selection alone.
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
      // Both done or neither done → leave as-is
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
  const activeLayer1 = layer1Results[activeTab]

  // Approve requires at least one income statement AND one balance sheet extracted
  const extractedIS = sheetNames.some(
    (s) => tabStates[s]?.status === 'done' && tabStates[s]?.sheetType === 'income_statement',
  )
  const extractedBS = sheetNames.some(
    (s) => tabStates[s]?.status === 'done' && tabStates[s]?.sheetType === 'balance_sheet',
  )
  const canApprove = extractedIS && extractedBS

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
      setLayer1Results({ ...layer1Results, [tabName]: result })
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

  function buildTableRows() {
    if (!activeLayer1) return []
    return Object.entries(activeLayer1.lineItems).map(([label, value]) => ({
      label,
      value: formatLineItemValue(value),
      isClickable: false,
    }))
  }

  const tableRows = buildTableRows()
  const placeholderTabs = ['Sheet 1', 'Sheet 2']

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Company</label>
          <div ref={comboRef} className="relative">
            <input
              type="text"
              value={comboSearch}
              onChange={(e) => {
                setComboSearch(e.target.value)
                setComboOpen(true)
                if (!e.target.value) {
                  setCompanyName('')
                  setCompanyId(null)
                }
              }}
              onFocus={() => { if (!hasUpload) setComboOpen(true) }}
              placeholder={companiesLoading ? 'Loading...' : 'Search or add company...'}
              disabled={hasUpload || creatingCompany}
              className="border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-52 disabled:bg-gray-50 disabled:text-gray-500"
            />
            {comboOpen && !hasUpload && (
              <div className="absolute top-full left-0 mt-1 w-full bg-white border border-gray-200 rounded shadow-lg z-50 max-h-48 overflow-y-auto">
                {comboSearch.trim() &&
                  !companies.some(
                    (c) => c.name.toLowerCase() === comboSearch.trim().toLowerCase(),
                  ) && (
                    <button
                      onClick={handleCreateCompany}
                      disabled={creatingCompany}
                      className="w-full text-left px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 border-b border-gray-100 font-medium disabled:opacity-50"
                    >
                      {creatingCompany ? 'Creating...' : `+ Add "${comboSearch.trim()}"`}
                    </button>
                  )}
                {filteredCompanies.length === 0 && !comboSearch.trim() && (
                  <p className="px-3 py-2 text-xs text-gray-400 italic">
                    No companies yet. Type a name to add one.
                  </p>
                )}
                {filteredCompanies.map((company) => (
                  <button
                    key={company.id}
                    onClick={() => handleSelectCompany(company)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    {company.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Period</label>
          <input
            type="text"
            value={reportingPeriod}
            onChange={(e) => setReportingPeriod(e.target.value)}
            placeholder="e.g. March 2024"
            disabled={hasUpload}
            className="border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36 disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>
        <div className="h-5 w-px bg-gray-200" />

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
            className="flex items-center gap-1.5 bg-white border border-gray-300 hover:border-blue-400 text-gray-700 text-sm px-3 py-1.5 rounded transition-colors disabled:opacity-50"
          >
            {uploading ? <LoadingSpinner size="sm" /> : '📂'}
            {uploading ? 'Uploading workbook...' : 'Upload Excel (.xlsx)'}
          </button>
        ) : (
          <button
            onClick={handleReupload}
            className="flex items-center gap-1.5 bg-white border border-gray-300 hover:border-blue-400 text-gray-700 text-sm px-3 py-1.5 rounded transition-colors"
          >
            🔄 Re-upload
          </button>
        )}

        {canApprove && (
          <button
            onClick={() => { new Audio(approveSfx).play(); approveStep1() }}
            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-1.5 rounded transition-colors font-medium"
          >
            ✓ Approve Extraction
          </button>
        )}

        <div className="ml-auto">
          <button
            onClick={loadMockStep2}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Skip to Step 2 (mock data)
          </button>
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

      {/* Metadata strip */}
      {activeLayer1 && (
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-1.5 flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
          <span>
            Scaling:{' '}
            <span className="font-medium text-gray-700">{activeLayer1.sourceScaling}</span>
          </span>
          <span>
            Column:{' '}
            <span className="font-medium text-gray-700">{activeLayer1.columnIdentified}</span>
          </span>
          <span>
            Items extracted:{' '}
            <span className="font-medium text-gray-700">
              {Object.keys(activeLayer1.lineItems).length}
            </span>
          </span>
        </div>
      )}

      {/* Split pane — left 2/3 for Excel preview, right 1/3 for extraction */}
      <SplitPane
        leftWidth="w-2/3"
        rightWidth="w-1/3"
        left={
          <div className="flex flex-col h-full overflow-hidden">
            <TabSelector
              tabs={hasUpload ? sheetNames : placeholderTabs}
              activeTab={activeTab || (hasUpload ? sheetNames[0] : placeholderTabs[0])}
              onChange={handleTabChange}
            />
            <ExcelViewer workbookUrl={workbookUrl} activeSheet={activeTab} />
          </div>
        }
        right={
          <div className="flex flex-col h-full overflow-hidden">
            <TabSelector
              tabs={hasUpload ? sheetNames : placeholderTabs}
              activeTab={activeTab || (hasUpload ? sheetNames[0] : placeholderTabs[0])}
              onChange={handleTabChange}
            />

            {!hasUpload ? (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <p className="text-sm">No file uploaded yet</p>
                  <p className="text-xs mt-1">Upload an Excel workbook to begin extraction</p>
                </div>
              </div>
            ) : activeTabState?.status === 'done' && activeLayer1 ? (
              <>
                <div className="px-3 py-1.5 bg-white border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                    Layer 1 Extraction
                  </span>
                  <span className="text-[10px] text-gray-400">{tableRows.length} line items</span>
                </div>
                <DataTable rows={tableRows} scrollRef={tableScrollRef} />
              </>
            ) : (
              <div className="flex flex-col h-full overflow-hidden">
                {/* Sheet type selector + run button */}
                <div className="px-3 py-3 bg-white border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
                  <label className="text-xs font-medium text-gray-600 whitespace-nowrap">
                    Sheet Type
                  </label>
                  <select
                    value={activeTabState?.sheetType ?? 'income_statement'}
                    onChange={(e) => setTabSheetType(activeTab, e.target.value as SheetType)}
                    disabled={activeTabState?.status === 'extracting'}
                    className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    <option value="income_statement">Income Statement</option>
                    <option value="balance_sheet">Balance Sheet</option>
                  </select>
                  <button
                    onClick={() => handleRunExtraction(activeTab)}
                    disabled={activeTabState?.status === 'extracting'}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-1.5 rounded transition-colors disabled:opacity-50"
                  >
                    {activeTabState?.status === 'extracting' ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      '⚡'
                    )}
                    {activeTabState?.status === 'extracting'
                      ? `Extracting "${activeTab}"...`
                      : 'Run Extraction'}
                  </button>
                </div>

                {/* Status area */}
                <div className="flex-1 flex items-center justify-center text-gray-400">
                  {activeTabState?.status === 'extracting' ? (
                    <LoadingSpinner
                      message={`Running AI extraction on "${activeTab}"...`}
                    />
                  ) : activeTabState?.status === 'error' ? (
                    <div className="text-center px-4">
                      <p className="text-sm font-medium text-red-500">Extraction failed</p>
                      <p className="text-xs mt-1 text-red-400">{activeTabState.error}</p>
                      <button
                        onClick={() => handleRunExtraction(activeTab)}
                        className="mt-3 text-xs text-blue-500 hover:text-blue-700 underline"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-sm">Ready to extract</p>
                      <p className="text-xs mt-1">
                        Confirm the sheet type above and click Run Extraction
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        }
      />
    </div>
  )
}
