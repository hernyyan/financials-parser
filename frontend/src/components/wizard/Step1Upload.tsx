import { useEffect, useRef, useState } from 'react'
import { useWizardState } from '../../hooks/useWizardState'
import TabSelector from '../shared/TabSelector'
import ExcelViewer from '../shared/ExcelViewer'
import PdfPageViewer from '../shared/PdfPageViewer'
import StatusBanner from '../shared/StatusBanner'
import PreviousReviewPreview from './PreviousReviewPreview'
import {
  uploadFile,
  runLayer1,
  runLayer1Pdf,
  getCompanies,
  createCompany,
  getCompanyContextStatus,
  checkExistingReview,
  getReviewData,
  saveLayer1Template,
  saveTabPreferences,
  checkLayout,
  getLayer1Template,
  extractSourceRows,
} from '../../api/client'
import { API_BASE } from '../../api/client'
import type { Company, CompanyContextStatus, Layer1Result, Layer1Template, Layer1TemplateRow, Layer2Result, SourceLayoutRow } from '../../types'
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
    setEditorState,
  } = useWizardState()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const comboRef = useRef<HTMLDivElement>(null)
  const splitContainerRef = useRef<HTMLDivElement>(null)

  const [uploading, setUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [status, setStatus] = useState<StatusMessage>(null)
  const [contextStatus, setContextStatus] = useState<CompanyContextStatus | null>(null)
  const [contextLoading, setContextLoading] = useState(false)

  // Single-tab assignment: one sheet per statement type
  const [assignments, setAssignments] = useState<{
    income_statement: string
    balance_sheet: string
    cash_flow_statement: string
  }>({ income_statement: '', balance_sheet: '', cash_flow_statement: '' })

  const [extractionStatus, setExtractionStatus] = useState<ExtractionStatus>('idle')
  const [extractionError, setExtractionError] = useState<string | null>(null)
  const [extractionElapsed, setExtractionElapsed] = useState(0)
  const [extractionProgress, setExtractionProgress] = useState<{ done: number; total: number } | null>(null)
  const [configuringTemplate, setConfiguringTemplate] = useState(false)

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
  const [previewData, setPreviewData] = useState<{
    layer1Data: Record<string, Layer1Result>
    layer2Data: Record<string, Layer2Result>
  } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)


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

  const canConfigureTemplate =
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
      const response = await uploadFile(file, companyName, reportingPeriod, companyId)
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

        // Preselect tabs from saved preferences for this company
        const blankAssignments = { income_statement: '', balance_sheet: '', cash_flow_statement: '' }
        const selectedCompany = companies.find(c => c.id === companyId)
        const prefs = selectedCompany?.tab_preferences
        if (prefs) {
          const preselected = { ...blankAssignments }
          for (const stmtType of Object.keys(blankAssignments) as (keyof typeof blankAssignments)[]) {
            const savedTab = prefs[stmtType]
            if (savedTab && response.sheetNames.includes(savedTab)) {
              preselected[stmtType] = savedTab
            }
          }
          setAssignments(preselected)
        } else {
          setAssignments(blankAssignments)
        }

        setExtractionStatus('idle')
        setExtractionError(null)
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
    setAssignments({ income_statement: '', balance_sheet: '', cash_flow_statement: '' })
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
    setAssignments({ income_statement: '', balance_sheet: '', cash_flow_statement: '' })
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
        const result = await runLayer1Pdf(sessionId!, pages, type, reportingPeriod, (s) => setExtractionElapsed(s))
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
    setExtractionElapsed(0)

    const stmtTypes = ['income_statement', 'balance_sheet', 'cash_flow_statement'] as const
    const assignedStmtTypes = stmtTypes.filter(s => assignments[s])
    setExtractionProgress({ done: 0, total: assignedStmtTypes.length })
    const results: Record<string, Awaited<ReturnType<typeof runLayer1>>> = {}

    const assignedTabs = assignedStmtTypes.map(s => assignments[s])
    const tabCounts: Record<string, number> = {}
    for (const t of assignedTabs) tabCounts[t] = (tabCounts[t] ?? 0) + 1

    // If IS has no template yet, skip straight to Configure Template flow —
    // same as clicking the Configure Template button. No need to run full
    // extraction first; the template editor will handle it.
    if (companyId && assignments['income_statement']) {
      const isTemplate = await getLayer1Template(companyId, 'income_statement').catch(() => null)
      if (!isTemplate) {
        setExtractionStatus('idle')
        // Delegate to the same flow as Configure Template
        await handleConfigureTemplate()
        return
      }
    }

    // IS runs alone first (most intensive), then BS + CFS run concurrently.
    // Backend semaphore(2) allows the concurrent pair without OOM risk.
    const runOne = async (stmtType: typeof stmtTypes[number]) => {
      const tab = assignments[stmtType]
      const sharedTab = tabCounts[tab] > 1
      const result = await runLayer1(sessionId!, tab, stmtType, reportingPeriod, undefined, companyId, sharedTab, (s) => setExtractionElapsed(s))
      results[stmtType] = result
      mergeLayer1Result(stmtType, {
        lineItems: result.lineItems,
        sourceScaling: result.sourceScaling,
        columnIdentified: result.columnIdentified,
        sourceSheet: tab,
        structured: result.structured,
        templateCheck: result.templateCheck,
      })
    }

    let anyFailed = false
    let firstError = ''

    // Phase 1: IS
    if (assignedStmtTypes.includes('income_statement')) {
      try { await runOne('income_statement') } catch (e: any) { anyFailed = true; firstError = e?.message ?? 'IS extraction failed.' }
      setExtractionProgress(p => p ? { ...p, done: p.done + 1 } : null)
    }

    // Phase 2: BS + CFS concurrently
    const phase2 = assignedStmtTypes.filter(s => s !== 'income_statement')
    if (phase2.length > 0) {
      const settled = await Promise.allSettled(phase2.map(async (s) => {
        try { await runOne(s) } finally { setExtractionProgress(p => p ? { ...p, done: p.done + 1 } : null) }
      }))
      settled.forEach((r, i) => {
        if (r.status === 'rejected') { anyFailed = true; firstError = firstError || (r.reason?.message ?? `${phase2[i]} extraction failed.`) }
      })
    }

    try {
      setExtractionProgress(null)
      if (anyFailed && Object.keys(results).length === 0) {
        setExtractionStatus('error')
        setExtractionError(firstError)
        setStatus({ type: 'error', message: firstError })
        return
      }
      if (anyFailed) {
        setStatus({ type: 'error', message: firstError })
      }
      setExtractionStatus('done')

      // Handle template editor / reconciliation for IS (if companyId is set)
      if (companyId) {
        const isResult = results['income_statement']
        const isTab = assignments['income_statement']

        if (isResult?.structured && isTab) {
          // Use full-fidelity source rows returned by the backend
          const stepCRows = isResult.sourceRows ?? []

          // Build layout rows (all Step C rows including any we can infer from extractionDebug)
          // Use stepCRows as the layout — these are the rows Python extracted
          const layoutRows: SourceLayoutRow[] = stepCRows.map(r => ({ row_index: r.row_index, label: r.label }))

          // Auto-save BS/CFS templates silently if no existing template
          const check = isResult.templateCheck
          for (const stmtType of ['balance_sheet', 'cash_flow_statement'] as const) {
            const r = results[stmtType]
            if (r?.structured && (!check || !check.has_template)) {
              const tmpl: Layer1Template = {
                meta: { statement_type: stmtType, created_at: new Date().toISOString() },
                rows: r.structured.rows ?? [],
              }
              saveLayer1Template(companyId, stmtType, tmpl).catch(() => {})
            }
          }

          if (!check || !check.has_template) {
            // First upload — open tabbed editor with AI's pre-filled IS template
            const aiTemplate = structuredToTemplate(isResult.structured, 'income_statement')
            setEditorState({
              mode: 'configure',
              statements: [{ statementType: 'income_statement', sheetName: isTab, stepCRows, existingTemplate: aiTemplate, labelColLetter: isResult.labelColLetter, valueColLetter: isResult.valueColLetter }],
            })
            return
          }

          // Has template — run layout diff to decide between silent proceed, reconcile, or direct extract
          try {
            const layoutCheck = await checkLayout(companyId, 'income_statement', layoutRows)

            if (!layoutCheck.has_layout || !layoutCheck.has_real_diff) {
              // No layout yet, or layout is unchanged / only silent diffs — proceed directly
              // (extraction already ran with AI, results are in layer1Results — just move to Step 2)
              return
            }

            // Real diff detected — show reconciliation UI
            const existingTemplate = await getLayer1Template(companyId, 'income_statement')
            setEditorState({
              mode: 'reconcile',
              statementType: 'income_statement',
              sheetName: isTab,
              stepCRows,
              existingTemplate: existingTemplate!,
              diff: layoutCheck.changes,
              oldLayout: [],
            })
            return
          } catch (layoutErr) {
            // Layout check failure is non-fatal — log and proceed
            console.warn('[Step1Upload] layout check failed, proceeding without reconciliation:', layoutErr)
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

  async function handleConfigureTemplate() {
    if (!sessionId || configuringTemplate) return
    setConfiguringTemplate(true)
    setExtractionElapsed(0)

    const tabCounts: Record<string, number> = {}
    Object.values(assignments).forEach(t => { if (t) tabCounts[t] = (tabCounts[t] ?? 0) + 1 })

    const assignedStatements = (
      ['income_statement', 'balance_sheet', 'cash_flow_statement'] as const
    ).filter(st => !!assignments[st])

    setExtractionProgress({ done: 0, total: assignedStatements.length })
    const tickHandle = setInterval(() => setExtractionElapsed(s => s + 1), 1000)

    try {
      // Run Extraction and Configure Template follow the same routing logic.
      // The only difference: Configure Template always shows the editor,
      // even when the layout is unchanged.
      const statementConfigs: import('../../types').TemplateStatementConfig[] = []
      let reconcileState: import('../../types').TemplateReconcileState | null = null

      // Helper: load config for a single statement
      const loadConfig = async (stmtType: 'income_statement' | 'balance_sheet' | 'cash_flow_statement') => {
        const sheetName = assignments[stmtType]
        const shared = tabCounts[sheetName] > 1
        const existingTemplate = companyId
          ? await getLayer1Template(companyId, stmtType).catch(() => null)
          : null

        if (!existingTemplate) {
          const result = await runLayer1(sessionId!, sheetName, stmtType, reportingPeriod, undefined, companyId, shared, (s) => setExtractionElapsed(s))
          const stepCRows = result.sourceRows ?? []
          const aiTemplate = result.structured ? structuredToTemplate(result.structured, stmtType) : null
          return { statementType: stmtType, sheetName, stepCRows, existingTemplate: aiTemplate, reconcile: null, labelColLetter: result.labelColLetter, valueColLetter: result.valueColLetter }
        }

        const sourceResult = await extractSourceRows(sessionId!, sheetName, stmtType, reportingPeriod, shared, (s) => setExtractionElapsed(s), companyId)
        const stepCRows = sourceResult.sourceRows ?? []

        if (companyId) {
          const layoutRows = stepCRows.map(r => ({ row_index: r.row_index, label: r.label }))
          const layoutCheck = await checkLayout(companyId, stmtType, layoutRows).catch(() => null)
          if (layoutCheck?.has_real_diff) {
            return {
              statementType: stmtType, sheetName, stepCRows, existingTemplate, stepCRows2: stepCRows,
              reconcile: { mode: 'reconcile' as const, statementType: stmtType, sheetName, stepCRows, existingTemplate, diff: layoutCheck.changes, oldLayout: [] as import('../../types').SourceLayoutRow[] },
            }
          }
        }
        return { statementType: stmtType, sheetName, stepCRows, existingTemplate, reconcile: null, labelColLetter: sourceResult.labelColLetter, valueColLetter: sourceResult.valueColLetter }
      }

      // IS first (most intensive), then BS + CFS concurrently
      const isStmt = 'income_statement' as const
      const others = assignedStatements.filter(s => s !== isStmt)

      if (assignedStatements.includes(isStmt)) {
        const cfg = await loadConfig(isStmt)
        setExtractionProgress(p => p ? { ...p, done: p.done + 1 } : null)
        if (cfg.reconcile) { reconcileState = cfg.reconcile; setEditorState(reconcileState); return }
        statementConfigs.push({ statementType: cfg.statementType, sheetName: cfg.sheetName, stepCRows: cfg.stepCRows, existingTemplate: cfg.existingTemplate, labelColLetter: cfg.labelColLetter, valueColLetter: cfg.valueColLetter })
      }

      if (others.length > 0 && !reconcileState) {
        const otherCfgs = await Promise.all(others.map(async s => {
          const cfg = await loadConfig(s as any)
          setExtractionProgress(p => p ? { ...p, done: p.done + 1 } : null)
          return cfg
        }))
        for (const cfg of otherCfgs) {
          if (cfg.reconcile && !reconcileState) { reconcileState = cfg.reconcile; break }
          else statementConfigs.push({ statementType: cfg.statementType, sheetName: cfg.sheetName, stepCRows: cfg.stepCRows, existingTemplate: cfg.existingTemplate, labelColLetter: cfg.labelColLetter, valueColLetter: cfg.valueColLetter })
        }
      }

      if (reconcileState) {
        setEditorState(reconcileState)
      } else {
        setEditorState({ mode: 'configure', statements: statementConfigs })
      }
    } catch (e: any) {
      setStatus({ type: 'error', message: `Failed to load template data: ${e.message}` })
    } finally {
      clearInterval(tickHandle)
      setConfiguringTemplate(false)
      setExtractionProgress(null)
    }
  }

  // Convert AI structured output (schema v1) to a schema v2 Layer1Template.
  // Operator assignment:
  //   - Uses the waterfall (if present) to assign outer-row operators — this
  //     correctly identifies which rows are true waterfall results (=) vs. bases (null) vs. subtractions (-)
  //   - Parent rows not in the waterfall default to null (their children summing to
  //     them is structural, not an operator relationship)
  //   - Children always get + (they add up to their parent)
  //   - Deeper than one level of nesting is collapsed to a single level
  function structuredToTemplate(structured: any, stmtType: string): Layer1Template {
    // Build row_id → operator map from waterfall
    const waterfallOps = new Map<number, string | null>()
    ;(structured?.waterfall ?? []).forEach((w: any) => {
      waterfallOps.set(w.row_id, w.operator ?? null)
    })
    const hasWaterfall = waterfallOps.size > 0

    function outerOp(r: Layer1TemplateRow): string | null {
      // BS/CFS: no operators needed — only structural hierarchy matters
      if (stmtType === 'balance_sheet' || stmtType === 'cash_flow_statement') return null
      if (hasWaterfall && r.id != null && waterfallOps.has(r.id)) return waterfallOps.get(r.id)!
      // IS with no waterfall: parents default to null, leaves use type
      if ((r.children ?? []).length > 0) return null
      return r.type === 'sum' ? '=' : '+'
    }

    function convertRow(r: Layer1TemplateRow): Layer1TemplateRow {
      const children = r.children ?? []
      if (children.length > 0) {
        const flatChildren: Layer1TemplateRow[] = []
        children.forEach(c => {
          const grandChildren = c.children ?? []
          if (grandChildren.length > 0) {
            grandChildren.forEach(gc => flatChildren.push({ ...gc, operator: '+', children: [] }))
            flatChildren.push({ ...c, operator: '+', children: [] })
          } else {
            flatChildren.push({ ...c, operator: '+', children: [] })
          }
        })
        return { ...r, operator: outerOp(r) as any, expanded: true, children: flatChildren }
      }
      return { ...r, operator: outerOp(r) as any, children: [] }
    }
    return {
      meta: { statement_type: stmtType, created_at: new Date().toISOString(), schema_version: 2 } as any,
      rows: (structured?.rows ?? []).map(convertRow),
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

  async function handleViewPrevious() {
    if (!duplicateCheck?.sessionId) return
    setPreviewLoading(true)
    try {
      const data = await getReviewData(duplicateCheck.sessionId)
      setPreviewData({
        layer1Data: data.layer1_data,
        layer2Data: data.layer2_data,
      })
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to load previous review.',
      })
    } finally {
      setPreviewLoading(false)
    }
  }

  function handleOverwrite() {
    setDuplicateCheck(null)
    setPreviewData(null)
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

  // ── Previous review preview (full-screen, replaces this step) ───────────

  if (previewData) {
    return (
      <PreviousReviewPreview
        layer1Data={previewData.layer1Data}
        layer2Data={previewData.layer2Data}
        companyName={companyName}
        reportingPeriod={reportingPeriod}
        onOverwrite={handleOverwrite}
        onClose={() => {
          setPreviewData(null)
          setDuplicateCheck(null)
          setPendingExtraction(null)
        }}
      />
    )
  }


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
              // Save tab preferences for Excel uploads (only assigned tabs, merge not overwrite)
              if (companyId && uploadFileType === 'excel') {
                const toSave: Record<string, string> = {}
                for (const [stmtType, tab] of Object.entries(assignments)) {
                  if (tab) toSave[stmtType] = tab
                }
                if (Object.keys(toSave).length > 0) {
                  saveTabPreferences(companyId, toSave).catch(() => {})
                }
              }
              // Auto-save label column to company when user approves extraction
              // (implicit approval of whatever column was used)
              if (companyId) {
                const isResult = layer1Results['income_statement']
                const labelColLetter = isResult?.labelColLetter
                if (labelColLetter && /^[A-Z]+$/i.test(labelColLetter)) {
                  let labelColIndex = 0
                  for (let i = 0; i < labelColLetter.toUpperCase().length; i++) {
                    labelColIndex = labelColIndex * 26 + (labelColLetter.toUpperCase().charCodeAt(i) - 64)
                  }
                  fetch(`/api/admin/companies/${companyId}/label-column`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ label_col: labelColIndex }),
                  }).catch(() => {})
                }
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
          /* Excel assignment panel — single tab per statement */
          <div className="flex-1 flex flex-col overflow-hidden min-w-[320px] bg-white">
            <div
              className="shrink-0 px-[14px] py-2.5 border-b border-gray-200 bg-white"
              style={{ position: 'sticky', top: 0, zIndex: 10 }}
            >
              <p className="text-[11px] text-muted-foreground">
                Assign one sheet per statement, then run extraction
              </p>
            </div>

            <div className="shrink-0 px-[14px] py-2.5 border-b border-border flex flex-col gap-1.5">
              <button
                onClick={handleRunExtraction}
                disabled={!canRunExtraction}
                className="w-full flex items-center justify-center gap-2 rounded-lg text-[13px] transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#030213', color: 'white', fontWeight: 500, padding: '8px 0', borderRadius: 8 }}
              >
                {extractionStatus === 'running' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Extracting... ({extractionElapsed}s){extractionProgress && extractionProgress.total > 1 ? ` · ${extractionProgress.done}/${extractionProgress.total}` : ''}
                  </>
                ) : (
                  'Run Extraction'
                )}
              </button>
              <button
                onClick={handleConfigureTemplate}
                disabled={!canConfigureTemplate}
                className="w-full flex items-center justify-center gap-2 rounded-lg text-[13px] border transition-colors disabled:opacity-50 hover:bg-slate-50"
                style={{ borderColor: '#e2e8f0', color: '#475569', fontWeight: 500, padding: '6px 0', borderRadius: 8 }}
              >
                {configuringTemplate ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Configuring... ({extractionElapsed}s){extractionProgress && extractionProgress.total > 1 ? ` · ${extractionProgress.done}/${extractionProgress.total}` : ''}
                  </>
                ) : (
                  'Configure Template'
                )}
              </button>
              {extractionError && (
                <p className="text-[11px] text-red-600">{extractionError}</p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {(
                [
                  { key: 'income_statement', label: 'Income Statement' },
                  { key: 'balance_sheet', label: 'Balance Sheet' },
                  { key: 'cash_flow_statement', label: 'Cash Flow Statement' },
                ] as const
              ).map(({ key, label }) => (
                <div key={key} className="border-b border-gray-200 px-[14px] py-3">
                  <p
                    className="text-muted-foreground uppercase mb-2"
                    style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.05em' }}
                  >
                    {label}
                  </p>
                  {sheetNames.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground italic">
                      Upload a file to assign a sheet
                    </p>
                  ) : (
                    <div
                      className="border border-gray-200 rounded-lg overflow-y-auto"
                      style={{ maxHeight: 130 }}
                    >
                      {sheetNames.map((tab) => {
                        const selected = assignments[key] === tab
                        return (
                          <label
                            key={tab}
                            className="flex items-center gap-2 cursor-pointer border-b border-gray-100 last:border-b-0"
                            style={{
                              padding: '5px 9px 5px 9px',
                              paddingRight: 44,
                              background: selected ? '#eff6ff' : undefined,
                              color: selected ? '#1d4ed8' : undefined,
                            }}
                          >
                            <input
                              type="radio"
                              name={key}
                              checked={selected}
                              onChange={() =>
                                setAssignments((prev) => ({ ...prev, [key]: tab }))
                              }
                              style={{ accentColor: '#185FA5', width: 13, height: 13, flexShrink: 0 }}
                            />
                            <span className="truncate text-[12px]">{tab}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
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
              . You can review the previous data before deciding.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleViewPrevious}
                disabled={previewLoading}
                className="w-full py-2 rounded-lg text-[13px] text-white transition-colors disabled:opacity-60"
                style={{ backgroundColor: '#185FA5', fontWeight: 500 }}
              >
                {previewLoading ? 'Loading…' : 'View Previous Data'}
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
