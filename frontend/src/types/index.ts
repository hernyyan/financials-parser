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

  // Current state
  currentStep: 1 | 2 | 3
  activeSheetTab: string
  selectedCell: string | null
  sidePanelOpen: boolean

  // Template editor / reconciliation state (cleared on save/cancel)
  editorState: TemplateEditorState | null
}

export interface StepCRow {
  row_index: number
  label: string
  value: number | null
  bold?: boolean
  italic?: boolean
  indent?: number
}

// One statement's worth of data for the template editor
export interface TemplateStatementConfig {
  statementType: string
  sheetName: string
  stepCRows: StepCRow[]
  existingTemplate: Layer1Template | null
  labelColLetter?: string   // column used for labels (editable in template editor)
  valueColLetter?: string   // column used for values (editable everywhere)
}

// Configure mode: tabbed editor for all assigned statements
export interface TemplateConfigureState {
  mode: 'configure'
  statements: TemplateStatementConfig[]
}

// Reconcile mode: 3-panel layout diff review (single statement)
export interface TemplateReconcileState {
  mode: 'reconcile'
  statementType: string
  sheetName: string
  stepCRows: Array<{ row_index: number; label: string; value: number | null }>
  existingTemplate: Layer1Template
  diff: LayoutDiffChange[]
  oldLayout: SourceLayoutRow[]
}

export type TemplateEditorState = TemplateConfigureState | TemplateReconcileState

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

export interface Layer2Result {
  statementType: string
  values: Record<string, number | null>
  reasoning: Record<string, string>
  validation: Record<string, ValidationCheck>
  flaggedFields: string[]
  fieldValidations: Record<string, string[]>
  aiMatchedValues: Record<string, number | null>
  calculationMeta: Record<string, CalculationMeta>
  sourceLabels: Record<string, string[]>
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
  layer1_data: Record<string, number>
  company_id?: number | null
  use_company_context?: boolean
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
  reportingPeriod: string
  /** Keyed by statement type: 'income_statement' | 'balance_sheet' */
  finalValues: Record<string, Record<string, number | null>>
  corrections: Correction[]
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
