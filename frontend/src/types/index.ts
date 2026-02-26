// All TypeScript interfaces for the Financial Analysis Platform

export interface WizardState {
  // Metadata
  companyName: string
  companyId: number | null
  reportingPeriod: string
  sessionId: string | null

  // Step 1
  uploadedFile: File | null
  sheetNames: string[]
  workbookUrl: string | null
  layer1Results: Record<string, Layer1Result>
  step1Approved: boolean

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

export interface Layer1Result {
  lineItems: Record<string, number>
  sourceScaling: string
  columnIdentified: string
}

export interface Layer2Result {
  statementType: string
  values: Record<string, number | null>
  reasoning: Record<string, string>
  validation: Record<string, ValidationCheck>
  flaggedFields: string[]
  fieldValidations: Record<string, string[]>
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
}

export interface Layer1Request {
  sessionId: string
  sheetName: string
  sheetType: string
  reportingPeriod: string
}

export interface Layer1Response extends Layer1Result {
  sheetName: string
}

export interface Layer2Request {
  session_id?: string | null
  statement_type: string
  layer1_data: Record<string, number>
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
}

// Company types

export interface Company {
  id: number
  name: string
  markdown_filename: string
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
