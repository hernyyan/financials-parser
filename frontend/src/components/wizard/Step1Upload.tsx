import { useEffect, useRef, useState } from 'react'
import { useWizardState } from '../../hooks/useWizardState'
import TabSelector from '../shared/TabSelector'
import ExcelViewer from '../shared/ExcelViewer'
import PdfPageViewer from '../shared/PdfPageViewer'
import StatusBanner from '../shared/StatusBanner'
import {
  uploadFile,
  runLayer1,
  runLayer1Pdf,
  getCompanies,
  createCompany,
  getCompanyContextStatus,
  checkExistingReview,
  continuePreviousReview,
  getStatementTabConfigs,
  saveStatementTabConfig,
} from '../../api/client'
import type { StatementTabConfig } from '../../api/client'
import { API_BASE } from '../../api/client'
import type { Company, CompanyContextStatus, Layer1Result, Layer2Result, Correction } from '../../types'
import { applyStatementTabConfig } from '../../utils/fuzzyMatch'
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

type StatusMessage = { type: 'success' | 'error' | 'info'; message: string } | null
type ExtractionStatus = 'idle' | 'running' | 'done' | 'error'

// ── Field definitions for the assignment panel ────────────────────────────

const IS_FIELDS = [
  'Total Revenue', 'COGS', 'Gross Profit', 'Total Operating Expenses',
  'EBITDA - Standard', 'EBITDA Adjustments', 'Adjusted EBITDA - Standard',
  'Depreciation & Amortization', 'Interest Expense/(Income)',
  'Other Expense / (Income)', 'Taxes', 'Net Income (Loss)',
  'LTM - Adj EBITDA items', 'Equity Cure', 'Adjusted EBITDA - Including Cures',
  'Covenant EBITDA',
]
const IS_BOLD = new Set([
  'Gross Profit', 'Total Operating Expenses', 'EBITDA - Standard',
  'Adjusted EBITDA - Standard', 'Net Income (Loss)', 'Adjusted EBITDA - Including Cures',
])

const BS_FIELDS = [
  'Cash & Cash Equivalents', 'Accounts Receivable', 'Inventory',
  'Prepaid Expenses', 'Other Current Assets', 'Total Current Assets',
  'Property, Plant & Equipment', 'Accumulated Depreciation',
  'Goodwill & Intangibles', 'Other non-current assets', 'Total Non-Current Assets',
  'Total Assets', 'Accounts Payable', 'Accrued Liabilities', 'Deferred Revenue',
  'Revolver - Balance Sheet', 'Current Maturities', 'Other Current Liabilities',
  'Total Current Liabilities', 'Long Term Loans', 'Long Term Leases',
  'Other Non-Current Liabilities', 'Total Non-Current Liabilities', 'Total Liabilities',
  'Paid in Capital', 'Retained Earnings', 'Other Equity', 'Total Equity',
  'Total Liabilities and Equity', 'Check',
]
const BS_BOLD = new Set([
  'Total Current Assets', 'Total Non-Current Assets', 'Total Assets',
  'Total Current Liabilities', 'Total Non-Current Liabilities',
  'Total Liabilities', 'Total Equity', 'Total Liabilities and Equity',
])

const CFS_FIELDS = [
  'Operating Cash Flow (Working Capital)', 'Operating Cash Flow (Non-Working Capital)',
  'Operating Cash Flow', 'Investing Cash Flow', 'Financing Cash Flow', 'CAPEX',
]
const CFS_BOLD = new Set(['Operating Cash Flow', 'Investing Cash Flow', 'Financing Cash Flow'])

const FIELDS = { income_statement: IS_FIELDS, balance_sheet: BS_FIELDS, cash_flow_statement: CFS_FIELDS }

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

// ── FieldAssignmentTable ──────────────────────────────────────────────────

interface FieldAssignmentTableProps {
  fields: string[]
  boldSet: Set<string>
  checkedTabs: string[]
  assignments: Record<string, string>
  onChange: (field: string, tab: string) => void
}

function FieldAssignmentTable({
  fields, boldSet, checkedTabs, assignments, onChange,
}: FieldAssignmentTableProps) {
  return (
    <div className="mx-[14px] mb-2 border border-gray-200 rounded-lg overflow-hidden text-[11px]">
      <div className="flex justify-between items-center px-2 py-1 bg-gray-100 border-b border-gray-200">
        <span className="text-muted-foreground" style={{ fontWeight: 600 }}>Field</span>
        <span className="text-muted-foreground" style={{ fontWeight: 600 }}>Tab</span>
      </div>
      <div style={{ maxHeight: 180, overflowY: 'auto' }}>
        {fields.map((field) => {
          const isBold = boldSet.has(field)
          return (
            <div
              key={field}
              className="flex justify-between items-center px-2 py-1 border-b border-gray-100 last:border-b-0"
              style={{ background: isBold ? '#f9fafb' : undefined }}
            >
              <span
                className={isBold ? '' : 'text-muted-foreground'}
                style={{
                  fontWeight: isBold ? 500 : 400,
                  paddingLeft: isBold ? 0 : 8,
                }}
              >
                {field}
              </span>
              <select
                value={assignments[field] ?? checkedTabs[0] ?? ''}
                onChange={(e) => onChange(field, e.target.value)}
                className="text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:outline-none"
                style={{ minWidth: 120 }}
              >
                {checkedTabs.map((tab) => (
                  <option key={tab} value={tab}>{tab}</option>
                ))}
              </select>
            </div>
          )
        })}
      </div>
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
    setFieldTabAssignments,
    approveStep1,
  } = useWizardState()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const comboRef = useRef<HTMLDivElement>(null)
  const splitContainerRef = useRef<HTMLDivElement>(null)

  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState<StatusMessage>(null)
  const [contextStatus, setContextStatus] = useState<CompanyContextStatus | null>(null)
  const [contextLoading, setContextLoading] = useState(false)

  // Assignment panel state
  const [assignments, setAssignments] = useState<{
    income_statement: string[]
    balance_sheet: string[]
    cash_flow_statement: string[]
  }>({ income_statement: [], balance_sheet: [], cash_flow_statement: [] })
  const [fieldAssignments, setFieldAssignments] = useState<Record<string, Record<string, string>>>({})
  const [extractionStatus, setExtractionStatus] = useState<ExtractionStatus>('idle')
  const [extractionError, setExtractionError] = useState<string | null>(null)

  // Resizable divider — left panel width as percentage
  const [leftPct, setLeftPct] = useState(65)

  // PDF-specific local state
  const [pdfActiveTab, setPdfActiveTab] = useState<'income_statement' | 'balance_sheet' | 'cash_flow_statement'>('income_statement')
  const [pdfExtracting, setPdfExtracting] = useState<Record<string, boolean>>({})

  // Company combobox state
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesLoading, setCompaniesLoading] = useState(false)
  const [comboOpen, setComboOpen] = useState(false)
  const [comboSearch, setComboSearch] = useState(companyName)
  const [creatingCompany, setCreatingCompany] = useState(false)
  const [duplicateCheck, setDuplicateCheck] = useState<{
    exists: boolean
    sessionId: string
    finalizedAt: string | null
  } | null>(null)
  const [pendingExtraction, setPendingExtraction] = useState<
    { type: 'pdf' } | { type: 'global' } | null
  >(null)

  const hasUpload = uploadFileType === 'excel'
    ? sheetNames.length > 0
    : uploadFileType === 'pdf'
      ? pdfPageCount > 0
      : false

  const activeTab = activeSheetTab || sheetNames[0] || ''

  function handleTabChange(tab: string) {
    setActiveSheetTab(tab)
  }

  // Load companies on mount
  useEffect(() => {
    setCompaniesLoading(true)
    getCompanies()
      .then(setCompanies)
      .catch(() => {})
      .finally(() => setCompaniesLoading(false))
  }, [])

  async function loadSavedTabConfigs(cid: number, availableTabs: string[]) {
    if (!cid || availableTabs.length === 0) return
    try {
      const configs = await getStatementTabConfigs(cid)
      for (const [stmtType, saved] of Object.entries(configs)) {
        if (saved.tabs.length < 2) continue
        const result = applyStatementTabConfig(saved, availableTabs)
        if (!result) continue
        setAssignments((prev) => ({ ...prev, [stmtType]: result.tabs }))
        setFieldAssignments((prev) => ({ ...prev, [stmtType]: result.fieldAssignments }))
      }
    } catch {}
  }

  // Load saved tab configs when company is selected (sheetNames may be empty at this point)
  useEffect(() => {
    if (!companyId) return
    loadSavedTabConfigs(companyId, sheetNames)
  }, [companyId])

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

  function normalizeCompanyName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '')
  }

  function findFuzzyMatches(input: string, allCompanies: Company[]): Company[] {
    const normalizedInput = normalizeCompanyName(input)
    if (normalizedInput.length < 2) return []
    return allCompanies.filter((c) => {
      const normalizedName = normalizeCompanyName(c.name)
      return normalizedName.includes(normalizedInput) || normalizedInput.includes(normalizedName)
    })
  }

  const hasExactMatch = companies.some(
    (c) => c.name.toLowerCase() === comboSearch.trim().toLowerCase(),
  )
  const filteredIds = new Set(filteredCompanies.map((c) => c.id))
  const fuzzyMatches =
    comboSearch.trim() && !hasExactMatch
      ? findFuzzyMatches(comboSearch.trim(), companies).filter((c) => !filteredIds.has(c.id))
      : []

  function handleSelectCompany(company: Company) {
    setCompanyName(company.name)
    setCompanyId(company.id)
    setComboSearch(company.name)
    setComboOpen(false)
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

  // canApprove: any statement has a completed layer1 result and no extraction is running
  const canApprove = !!(
    (
      layer1Results['income_statement'] ||
      layer1Results['balance_sheet'] ||
      layer1Results['cash_flow_statement']
    ) &&
    extractionStatus !== 'running' &&
    !Object.values(pdfExtracting).some(Boolean)
  )

  // extractedSheetNames: tabs whose statement type has a completed layer1Result
  const extractedSheetNames = sheetNames.filter((s) => {
    for (const [stmtType, tabs] of Object.entries(assignments)) {
      if (tabs.includes(s) && layer1Results[stmtType]) return true
    }
    return false
  })

  // Any tabs assigned at all
  const anyAssigned =
    assignments.income_statement.length > 0 ||
    assignments.balance_sheet.length > 0 ||
    assignments.cash_flow_statement.length > 0

  const canRunExtraction =
    hasUpload &&
    anyAssigned &&
    !!sessionId &&
    reportingPeriod.trim() !== '' &&
    companyName.trim() !== '' &&
    extractionStatus !== 'running'

  // ── Tab assignment toggle ───────────────────────────────────────────────

  function toggleTabAssignment(
    stmtType: 'income_statement' | 'balance_sheet' | 'cash_flow_statement',
    tab: string,
  ) {
    const current = assignments[stmtType]
    const isRemoving = current.includes(tab)
    const updated = isRemoving ? current.filter((t) => t !== tab) : [...current, tab]
    setAssignments((prev) => ({ ...prev, [stmtType]: updated }))
    if (isRemoving) {
      setFieldAssignments((prev) => {
        const stmtFa = { ...(prev[stmtType] ?? {}) }
        for (const [field, assignedTab] of Object.entries(stmtFa)) {
          if (assignedTab === tab) delete stmtFa[field]
        }
        return { ...prev, [stmtType]: stmtFa }
      })
    }
  }

  function setFieldTabAssignment(stmtType: string, field: string, tab: string) {
    setFieldAssignments((prev) => ({
      ...prev,
      [stmtType]: { ...(prev[stmtType] ?? {}), [field]: tab },
    }))
  }

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
        // Reset assignment state for new file, then auto-load saved configs
        setAssignments({ income_statement: [], balance_sheet: [], cash_flow_statement: [] })
        setFieldAssignments({})
        setExtractionStatus('idle')
        setExtractionError(null)
        if (companyId) loadSavedTabConfigs(companyId, response.sheetNames)
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
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleReupload() {
    setUploadedFile(null)
    setSessionId(null)
    setSheetNames([])
    setWorkbookUrl(null)
    setLayer1Results({})
    setAssignments({ income_statement: [], balance_sheet: [], cash_flow_statement: [] })
    setFieldAssignments({})
    setExtractionStatus('idle')
    setExtractionError(null)
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
    setAssignments({ income_statement: [], balance_sheet: [], cash_flow_statement: [] })
    setFieldAssignments({})
    setExtractionStatus('idle')
    setExtractionError(null)
    setStatus(null)
    setContextStatus(null)
    setUploadFileType(null)
    setPdfPageCount(0)
    setPdfUrl(null)
    setPdfPageAssignments({})
  }

  // ── PDF extraction ──────────────────────────────────────────────────────

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

  async function handlePdfRunAllInner() {
    const stmtTypes: ('income_statement' | 'balance_sheet' | 'cash_flow_statement')[] =
      ['income_statement', 'balance_sheet', 'cash_flow_statement']

    const toRun = stmtTypes.filter((type) =>
      Object.values(pdfPageAssignments).includes(type),
    )

    if (toRun.length === 0) {
      setStatus({ type: 'error', message: 'Select pages for at least one statement before running extraction.' })
      return
    }

    const extracting: Record<string, boolean> = {}
    for (const type of toRun) extracting[type] = true
    setPdfExtracting(extracting)
    setStatus(null)

    await Promise.allSettled(toRun.map(async (type) => {
      const pages = Object.entries(pdfPageAssignments)
        .filter(([, t]) => t === type)
        .map(([p]) => parseInt(p))
        .sort((a, b) => a - b)
      try {
        const result = await runLayer1Pdf(sessionId!, pages, type, reportingPeriod)
        mergeLayer1Result(type, {
          lineItems: result.lineItems,
          sourceScaling: result.sourceScaling,
          columnIdentified: result.columnIdentified,
          sourceSheet: `PDF pages ${pages.join(', ')}`,
        })
      } catch (err) {
        setStatus({ type: 'error', message: `Extraction failed for ${type}: ${err instanceof Error ? err.message : 'Unknown error'}` })
      } finally {
        setPdfExtracting((prev) => ({ ...prev, [type]: false }))
      }
    }))
  }

  async function handlePdfRunAll() {
    if (!sessionId || !reportingPeriod.trim() || !companyName.trim()) {
      setStatus({ type: 'error', message: 'Please enter company name and reporting period before running extraction.' })
      return
    }

    if (companyId) {
      try {
        const existing = await checkExistingReview(companyId, reportingPeriod)
        if (existing.exists) {
          setDuplicateCheck({
            exists: true,
            sessionId: existing.session_id!,
            finalizedAt: existing.finalized_at ?? null,
          })
          setPendingExtraction({ type: 'pdf' })
          return
        }
      } catch {
        // proceed on check failure
      }
    }

    handlePdfRunAllInner()
  }

  // ── Excel extraction ────────────────────────────────────────────────────

  async function runExtractionInner() {
    setExtractionStatus('running')
    setExtractionError(null)

    const tasks: Promise<void>[] = []

    for (const stmtType of [
      'income_statement',
      'balance_sheet',
      'cash_flow_statement',
    ] as const) {
      const tabs = assignments[stmtType]
      if (tabs.length === 0) continue

      if (tabs.length === 1) {
        tasks.push(
          runLayer1(sessionId!, tabs[0], stmtType, reportingPeriod).then((result) =>
            mergeLayer1Result(stmtType, {
              lineItems: result.lineItems,
              sourceScaling: result.sourceScaling,
              columnIdentified: result.columnIdentified,
              sourceSheet: tabs[0],
            }),
          ),
        )
      } else {
        // Multi-tab: run once per unique tab with fields_filter for that tab
        const tabFieldMap: Record<string, string[]> = {}
        const perFieldAssignments = fieldAssignments[stmtType] ?? {}
        const defaultTab = tabs[0]
        const allFields = FIELDS[stmtType as keyof typeof FIELDS] ?? []
        for (const field of allFields) {
          const tab = perFieldAssignments[field] ?? defaultTab
          if (!tabFieldMap[tab]) tabFieldMap[tab] = []
          tabFieldMap[tab].push(field)
        }

        const perTabResults: Record<string, Record<string, number>> = {}
        const tabPromises = Object.entries(tabFieldMap).map(([tab, fields]) =>
          runLayer1(
            sessionId!,
            tab,
            stmtType,
            reportingPeriod,
            fields.length > 0 ? fields : undefined,
          ).then((result) => {
            perTabResults[tab] = result.lineItems
          }),
        )

        tasks.push(
          Promise.all(tabPromises).then(() => {
            const merged: Record<string, number> = {}
            for (const items of Object.values(perTabResults)) {
              Object.assign(merged, items)
            }
            mergeLayer1Result(stmtType, {
              lineItems: merged,
              sourceScaling: 'multi-tab',
              columnIdentified: tabs.join(', '),
              sourceSheet: tabs.join(', '),
            })
          }),
        )
      }
    }

    try {
      await Promise.allSettled(tasks)
      setExtractionStatus('done')
      setFieldTabAssignments(fieldAssignments)
      // Save tab configs for all statement types that used multi-tab
      if (companyId) {
        for (const stmtType of ['income_statement', 'balance_sheet', 'cash_flow_statement']) {
          const tabs = assignments[stmtType as keyof typeof assignments] ?? []
          if (tabs.length >= 2) {
            const config: StatementTabConfig = {
              tabs,
              fieldAssignments: fieldAssignments[stmtType] ?? {},
            }
            saveStatementTabConfig(companyId, stmtType, config).catch(() => {})
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Extraction failed.'
      setExtractionStatus('error')
      setExtractionError(msg)
      setStatus({ type: 'error', message: msg })
    }
  }

  async function handleRunExtraction() {
    if (!sessionId || !reportingPeriod.trim() || !companyName.trim()) return

    if (companyId) {
      try {
        const existing = await checkExistingReview(companyId, reportingPeriod)
        if (existing.exists) {
          setDuplicateCheck({
            exists: true,
            sessionId: existing.session_id!,
            finalizedAt: existing.finalized_at ?? null,
          })
          setPendingExtraction({ type: 'global' })
          return
        }
      } catch {
        // proceed on check failure
      }
    }

    runExtractionInner()
  }

  async function handleContinuePrevious() {
    if (!companyId) return
    setDuplicateCheck(null)
    try {
      const data = await continuePreviousReview(companyId, reportingPeriod)
      setSessionId(data.session_id)
      setLayer1Results((data.layer1_data as Record<string, Layer1Result>) || {})
      if (data.layer2_data) {
        setLayer2Results(data.layer2_data as Record<string, Layer2Result>)
      }
      if (data.corrections && Array.isArray(data.corrections)) {
        for (const c of data.corrections) {
          addCorrection(c as Correction)
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
              {fuzzyMatches.length > 0 && (
                <div className="border-t border-border">
                  <p className="text-[11px] text-muted-foreground italic px-3 py-1">
                    Did you mean?
                  </p>
                  {fuzzyMatches.map((company) => (
                    <div
                      key={company.id}
                      className="px-3 py-2 text-[13px] hover:bg-amber-50 cursor-pointer flex items-center gap-2 border-l-2 border-amber-400"
                      onClick={() => handleSelectCompany(company)}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      {company.name}
                    </div>
                  ))}
                </div>
              )}
              {comboSearch.trim() && !hasExactMatch && (
                <div
                  className="px-3 py-2 text-[13px] text-blue-600 hover:bg-blue-50 cursor-pointer flex items-center gap-1.5 border-t border-border"
                  onClick={handleCreateCompany}
                >
                  {creatingCompany ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  {creatingCompany ? 'Creating...' : `Add "${comboSearch.trim()}" as new company`}
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
          className="border-r border-border flex flex-col min-w-0 shrink-0"
          style={{ width: `${leftPct}%` }}
        >
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
          /* PDF extraction panel — unchanged */
          <div className="flex-1 flex flex-col min-w-[320px]">
            {/* Global Run Extraction button — always visible at top */}
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

            {/* Tab selector */}
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

            {/* Tab content — results or instructions */}
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
          /* Excel assignment panel */
          <div className="flex-1 flex flex-col overflow-hidden min-w-[320px] bg-white">
            {/* Panel header */}
            <div
              className="shrink-0 px-[14px] py-2.5 border-b border-gray-200 bg-white"
              style={{ position: 'sticky', top: 0, zIndex: 10 }}
            >
              <p className="text-[11px] text-muted-foreground">
                Assign tabs to statements, then run extraction
              </p>
            </div>

            {/* Run Extraction button — always visible, not scrolled away */}
            <div className="shrink-0 px-[14px] py-2.5 border-b border-border">
              <button
                onClick={handleRunExtraction}
                disabled={!canRunExtraction}
                className="w-full flex items-center justify-center gap-2 rounded-lg text-[13px] transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#030213', color: 'white', fontWeight: 500, padding: '8px 0', borderRadius: 8 }}
              >
                {extractionStatus === 'running' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Running...
                  </>
                ) : (
                  'Run Extraction'
                )}
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              {/* Income Statement block */}
              <AssignmentBlock
                label="Income Statement"
                stmtType="income_statement"
                checkedTabs={assignments.income_statement}
                sheetNames={sheetNames}
                fields={IS_FIELDS}
                boldSet={IS_BOLD}
                fieldAssignments={fieldAssignments['income_statement'] ?? {}}
                onToggleTab={(tab) => toggleTabAssignment('income_statement', tab)}
                onFieldAssign={(field, tab) =>
                  setFieldTabAssignment('income_statement', field, tab)
                }
              />

              {/* Balance Sheet block */}
              <AssignmentBlock
                label="Balance Sheet"
                stmtType="balance_sheet"
                checkedTabs={assignments.balance_sheet}
                sheetNames={sheetNames}
                fields={BS_FIELDS}
                boldSet={BS_BOLD}
                fieldAssignments={fieldAssignments['balance_sheet'] ?? {}}
                onToggleTab={(tab) => toggleTabAssignment('balance_sheet', tab)}
                onFieldAssign={(field, tab) =>
                  setFieldTabAssignment('balance_sheet', field, tab)
                }
              />

              {/* Cash Flow Statement block */}
              <AssignmentBlock
                label="Cash Flow Statement"
                stmtType="cash_flow_statement"
                checkedTabs={assignments.cash_flow_statement}
                sheetNames={sheetNames}
                fields={CFS_FIELDS}
                boldSet={CFS_BOLD}
                fieldAssignments={fieldAssignments['cash_flow_statement'] ?? {}}
                onToggleTab={(tab) => toggleTabAssignment('cash_flow_statement', tab)}
                onFieldAssign={(field, tab) =>
                  setFieldTabAssignment('cash_flow_statement', field, tab)
                }
              />
            </div>
          </div>
        )}
      </div>

      {/* Duplicate check modal */}
      {duplicateCheck?.exists && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-[15px] mb-2" style={{ fontWeight: 600 }}>
              Existing Data Found
            </h3>
            <p className="text-[13px] text-muted-foreground mb-5">
              <span style={{ fontWeight: 500 }}>{companyName}</span> — {reportingPeriod} was
              already loaded and finalized
              {duplicateCheck.finalizedAt
                ? ` on ${new Date(duplicateCheck.finalizedAt).toLocaleDateString()}`
                : ''}
              .
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleContinuePrevious}
                className="w-full py-2 rounded-lg text-[13px] bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                style={{ fontWeight: 500 }}
              >
                Continue with Previous
              </button>
              <button
                onClick={handleOverwrite}
                className="w-full py-2 rounded-lg text-[13px] border border-border text-foreground hover:bg-gray-50 transition-colors"
                style={{ fontWeight: 500 }}
              >
                Upload New &amp; Overwrite
              </button>
              <button
                onClick={() => {
                  setDuplicateCheck(null)
                  setPendingExtraction(null)
                }}
                className="w-full py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground transition-colors"
                style={{ fontWeight: 500 }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── AssignmentBlock ───────────────────────────────────────────────────────

interface AssignmentBlockProps {
  label: string
  stmtType: string
  checkedTabs: string[]
  sheetNames: string[]
  fields: string[]
  boldSet: Set<string>
  fieldAssignments: Record<string, string>
  onToggleTab: (tab: string) => void
  onFieldAssign: (field: string, tab: string) => void
}

function AssignmentBlock({
  label,
  checkedTabs,
  sheetNames,
  fields,
  boldSet,
  fieldAssignments,
  onToggleTab,
  onFieldAssign,
}: AssignmentBlockProps) {
  const showFieldTable = checkedTabs.length >= 2

  return (
    <div className="border-b border-gray-200">
      {/* Section label */}
      <div className="flex items-center gap-2 px-[14px] pt-3 pb-1.5">
        <span
          className="text-muted-foreground uppercase"
          style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.05em' }}
        >
          {label}
        </span>
        {checkedTabs.length >= 2 && (
          <span
            className="bg-blue-50 text-blue-700 rounded px-1 py-0.5"
            style={{ fontSize: 10, fontWeight: 500 }}
          >
            {checkedTabs.length} tabs
          </span>
        )}
      </div>

      {/* Listbox */}
      {sheetNames.length === 0 ? (
        <p className="px-[14px] pb-2 text-[11px] text-muted-foreground italic">
          Upload a file to assign tabs
        </p>
      ) : (
        <div
          className="mx-[14px] mb-2 border border-gray-200 rounded-lg overflow-y-auto"
          style={{ maxHeight: 130 }}
        >
          {sheetNames.map((tab) => {
            const checked = checkedTabs.includes(tab)
            return (
              <label
                key={tab}
                className="flex items-center gap-2 cursor-pointer border-b border-gray-100 last:border-b-0"
                style={{
                  padding: '5px 9px',
                  background: checked ? '#eff6ff' : undefined,
                  color: checked ? '#1d4ed8' : undefined,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleTab(tab)}
                  style={{ accentColor: '#185FA5', width: 13, height: 13, flexShrink: 0 }}
                />
                <span className="truncate text-[12px]">{tab}</span>
              </label>
            )
          })}
        </div>
      )}

      {/* Field assignment table — only when 2+ tabs checked */}
      {showFieldTable && (
        <FieldAssignmentTable
          fields={fields}
          boldSet={boldSet}
          checkedTabs={checkedTabs}
          assignments={fieldAssignments}
          onChange={onFieldAssign}
        />
      )}
    </div>
  )
}
