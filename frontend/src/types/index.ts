// All TypeScript interfaces for the Financial Analysis Platform

export interface WizardState {
  // Metadata
  companyName: string
  companyId: number | null
  reportingPeriod: string
  sessionId: string | null

  // Step 1 — file type
  uploadFileType: 'excel' | 'pdf' | null

  // Step 1 — Excel
  uploadedFile: File | null
  sheetNames: string[]
  workbookUrl: string | null
  layer1Results: Record<string, Layer1Result>
  step1Approved: boolean
  useCompanyContext: boolean

  // Step 1 — PDF
  pdfPageCount: number
  pdfUrl: string | null
  pdfPageAssignments: Record<number, 'income_statement' | 'balance_sheet' | 'cash_flow_statement'>

  // Step 2
  layer2Results: Record<string, Layer2Result>
  corrections: Correction[]
  step2Approved: boolean
  /** Per-field formula map edited during session; persisted on finalization */
  formulas: CompanyFormulas
  /** Per-field manual number overrides (highest priority over formula value) */
  manualOverrides: Record<string, Record<string, number | null>>

  // Current state
  currentStep: 1 | 2 | 3
  activeSheetTab: string
  selectedCell: string | null
  sidePanelOpen: boolean

  // Sheet tab assignments (lifted so WizardShell can save them on template save)
  sheetAssignments: Record<string, string>

  // Template editor / reconciliation state (cleared on save/cancel)
  editorState: TemplateEditorState | null
  // Snapshot of editorState taken when proceeding to Step 2 via template editor path
  lastEditorState: TemplateEditorState | null
}

export interface StepCRow {
  row_index: number
  label: string
  value: number | null
  bold?: boolean
  italic?: boolean
  indent?: number
}

// Per-statement reconcile data (populated only when panelMode === 'reconcile')
export interface StatementReconcileData {
  diff: LayoutDiffChange[]
  oldLayout: StepCRow[]  // full row metadata so the left panel renders with formatting
}

// One statement's worth of data for the template configuration workflow.
// panelMode is determined per-statement: 'configure' = 2-panel, 'reconcile' = 3-panel.
export interface TemplateStatementConfig {
  statementType: string
  sheetName: string
  stepCRows: StepCRow[]
  existingTemplate: Layer1Template | null
  labelColLetter?: string
  valueColLetter?: string
  panelMode: 'configure' | 'reconcile'
  reconcileData?: StatementReconcileData
}

// Unified editor state — always a tabbed session, one entry per assigned statement.
// Each statement independently carries its own panel mode.
export interface TemplateEditorState {
  statements: TemplateStatementConfig[]
}

export interface Layer1TemplateRow {
  id: number
  label: string
  // Schema v2 fields (flat operator model)
  source_row?: number                     // 1-based Excel row number from Step C
  operator?: '+' | '-' | '=' | null       // null = blank (section break / informational)
  expanded?: boolean                       // whether children are visible
  children: Layer1TemplateRow[]            // always present (empty array for leaf nodes)
  value?: number | null                    // for display only
  // Schema v1 fields (legacy — admin view / BS / CFS)
  type?: 'individual' | 'sum' | 'margin'
  bold?: boolean
  italic?: boolean
  indent?: number
  computed_as?: string
  derived_from?: number[]
  validated?: boolean
  validation_note?: string
}

// A single row from the source layout record (label column only)
export interface SourceLayoutRow {
  row_index: number
  label: string
}

// A single diff change from the LCS comparison
export interface LayoutDiffChange {
  type: 'add' | 'remove' | 'rename'
  old: SourceLayoutRow | null
  new: SourceLayoutRow | null
  silent: boolean
}

// Result of /check-layout endpoint
export interface LayoutCheckResult {
  has_template: boolean
  has_layout: boolean
  has_real_diff: boolean
  silent_update: boolean
  changes: LayoutDiffChange[]
  old_layout?: StepCRow[]  // full stored layout rows returned by backend (snake_case from API)
}

export interface WaterfallStep {
  row_id: number
  label: string
  operator: null | '+' | '-' | '='
}

export interface Layer1Template {
  meta: { statement_type: string; created_at: string }
  rows: Layer1TemplateRow[]
  waterfall?: WaterfallStep[]
}

export interface TemplateCheckResult {
  has_template: boolean
  unmatched_items: Layer1TemplateRow[]
}

export interface Layer1Result {
  lineItems: Record<string, number>
  sourceScaling: string
  columnIdentified: string
  sourceSheet: string
  structured?: Layer1Template
  templateCheck?: TemplateCheckResult
  labelColLetter?: string
  valueColLetter?: string
}

export interface CalculationMeta {
  type: 'calculated' | 'overridden' | 'source_matched_fallback'
  formula?: string
  inputs?: Record<string, number | null>
  python_result?: number
  ai_matched_value?: number | null
  match_status?: 'match' | 'discrepancy' | 'not_found_in_source' | 'n/a'
  override_value?: number
  math_ok?: boolean
  reason?: string
  readonly?: boolean
}

// ── Layer 2 formula types ─────────────────────────────────────────────────────

export interface FormulaRow {
  operator: '+' | '-'
  row: number      // source_row from L1 template
  label: string    // verbatim label from L1 template
}

export type L2Formula = FormulaRow[]

/** All formulas for one company: stmtType -> fieldName -> formula */
export type CompanyFormulas = Record<string, Record<string, L2Formula>>

// ── Layer 2 result (new formula-based shape) ──────────────────────────────────

export interface Layer2Result {
  statementType: string
  formulaValues: Record<string, number | null>     // computed from L1 formulas
  pythonCheckValues: Record<string, number | null> // L2-to-L2 arithmetic check
  pythonFlaggedFields: string[]                    // fields where formula ≠ python check
  formulas: Record<string, L2Formula>              // field -> formula (initial or saved)
  flaggedFields: string[]
  sourceLabels: Record<string, string[]>           // for left-panel highlight compat
}

export interface ValidationCheck {
  checkName: string
  status: 'PASS' | 'FAIL'
  details: string
}

export interface Correction {
  fieldName: string
  originalValue: number
  correctedValue: number
  reasoning?: string
  tag: 'one_off_error' | 'company_specific' | 'general_fix'
  timestamp: string
}

// API Response/Request types

export interface UploadResponse {
  sessionId: string
  sheetNames: string[]
  workbookUrl: string
  fileType: 'excel' | 'pdf'
  pdfPageCount?: number
  pdfUrl?: string
}

export interface Layer1Request {
  sessionId: string
  sheetName: string
  sheetType: string
  reportingPeriod: string
  companyId?: number | null
}

export interface Layer1ExtractionDebug {
  columnIndex: number
  columnLetter: string | null
  periodMatched: string | null
  skipRows: number
  sectionStartRow: number
  sectionEndRow: number
  stepCRowCount: number
  stepDRowCount: number
  attempts: number
}

export interface Layer1Response {
  lineItems: Record<string, number>
  sourceScaling: string
  columnIdentified: string
  sheetName: string
  structured?: Layer1Template
  templateCheck?: TemplateCheckResult
  extractionDebug?: Layer1ExtractionDebug
  sourceRows?: StepCRow[]
  labelColLetter?: string   // e.g. "C" — column used for row labels
  valueColLetter?: string   // e.g. "AN" — column used for period values
}

export interface Layer2Request {
  session_id?: string | null
  statement_type: string
  layer1_structured: Record<string, unknown>   // full structured tree from Layer 1
  company_id?: number | null
}

export interface CompanyContextStatus {
  company_id: number
  company_name: string
  has_rules: boolean
  rule_count: number
  word_count: number
}

export interface CorrectionRequest {
  sessionId?: string | null
  fieldName: string
  statementType: string
  originalValue: number
  correctedValue: number
  reasoning?: string
  tag?: 'one_off_error' | 'company_specific' | 'general_fix'
}

export interface FinalizeRequest {
  sessionId?: string | null
  companyName: string
  companyId?: number | null
  reportingPeriod: string
  /** Keyed by statement type: 'income_statement' | 'balance_sheet' | 'cash_flow_statement' */
  finalValues: Record<string, Record<string, number | null>>
  corrections: Correction[]
  /** Formula map to persist on finalization: stmtType -> fieldName -> FormulaRow[] */
  formulas?: CompanyFormulas | null
  /** L1 structured trees: stmtType -> structured tree (for formula validation) */
  layer1Structured?: Record<string, Record<string, unknown>> | null
}

export interface FinalizeResponse {
  success: boolean
  sessionId?: string | null
  companyName: string
  reportingPeriod: string
  finalizedAt: string
  finalOutput: Record<string, Record<string, number | null>>
  correctionsCount: number
  flaggedCount: number
}

export interface ExportResponse {
  session_id: string
  csv_content: string
  final_values: Record<string, number | null>
}

// Template types

export interface TemplateSection {
  header: string | null
  fields: string[]
}

export interface TemplateStatement {
  sections: TemplateSection[]
  allFields: string[]
}

export interface TemplateResponse {
  income_statement: TemplateStatement
  balance_sheet: TemplateStatement
  cash_flow_statement: TemplateStatement
}

// Session / review continuity types

export interface ExistingReviewCheck {
  exists: boolean
  session_id: string | null
  finalized_at: string | null
}

export interface ContinuedReview {
  session_id: string
  company_name: string
  reporting_period: string
  layer1_data: Record<string, Layer1Result>
  layer2_data: Record<string, Layer2Result>
  corrections: CorrectionProcessItem[]
}

// Company types

export interface Company {
  id: number
  name: string
  tab_preferences?: Record<string, string> | null
}

// Correction processing types

export interface CorrectionProcessItem {
  field_name: string
  statement_type: string
  layer2_value: number | null
  layer2_reasoning: string | null
  layer2_validation: string | null
  corrected_value: number
  analyst_reasoning?: string
  tag: 'one_off_error' | 'company_specific' | 'general_fix'
}

export interface CorrectionProcessRequest {
  company_id: number | null
  company_name: string
  period: string
  corrections: CorrectionProcessItem[]
}

export interface CorrectionProcessResponse {
  processed: Record<string, number>
  general_fix_csv_path: string
  company_specific_queued: number
}
