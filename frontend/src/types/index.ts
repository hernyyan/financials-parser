// All TypeScript interfaces for the Financial Analysis Platform

export type StatusMessage = { type: 'success' | 'error' | 'info'; message: string } | null
export type StatementType = 'income_statement' | 'balance_sheet' | 'cash_flow_statement'
export type DuplicateCheck = { exists: boolean; sessionId: string; finalizedAt: string | null } | null
export type PendingExtraction = { type: 'pdf' } | { type: 'global' } | null

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
  pdfPageAssignments: Record<number, StatementType>

  // Step 2
  layer2Results: Record<string, Layer2Result>
  corrections: Correction[]
  step2Approved: boolean

  // Current state
  currentStep: 1 | 2 | 3
  activeSheetTab: string
  selectedCell: string | null
  sidePanelOpen: boolean
}

export interface Layer1TemplateRow {
  id: number
  type: 'individual' | 'sum'
  label: string
  value?: number | null
  bold?: boolean
  italic?: boolean
  indent?: number
  children: Layer1TemplateRow[]
  computed_as?: string
  derived_from?: number[]
  validated?: boolean
  validation_note?: string
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

export interface Layer1Response {
  lineItems: Record<string, number>
  sourceScaling: string
  columnIdentified: string
  sheetName: string
  structured?: Layer1Template
  templateCheck?: TemplateCheckResult
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
