import type {
  UploadResponse,
  Layer1Response,
  Layer1Result,
  Layer2Request,
  Layer2Result,
  CalculationMeta,
  CorrectionRequest,
  FinalizeRequest,
  FinalizeResponse,
  ExportResponse,
  TemplateResponse,
  Company,
  CorrectionProcessRequest,
  CorrectionProcessResponse,
  CompanyContextStatus,
  ISTabConfig,
} from '../types'

export const API_BASE = import.meta.env.VITE_API_URL || '/api'

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `API error ${res.status}`
    try {
      const body = await res.json()
      const detail = body.detail ?? body.message
      if (Array.isArray(detail)) {
        // Pydantic v2 validation errors — format each one
        message = detail.map((e: { loc?: unknown[]; msg?: string }) =>
          `${(e.loc ?? []).join('.')}: ${e.msg ?? e}`
        ).join('; ')
      } else if (detail) {
        message = String(detail)
      }
    } catch {
      message = (await res.text().catch(() => message)) || message
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

// POST /upload
export async function uploadFile(
  file: File,
  companyName: string = '',
  reportingPeriod: string = '',
): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('company_name', companyName)
  formData.append('reporting_period', reportingPeriod)

  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  })
  return handleResponse<UploadResponse>(res)
}

// POST /layer1/run
export async function runLayer1(
  sessionId: string,
  sheetName: string,
  sheetType: string,
  reportingPeriod: string,
  fieldsFilter?: string[],
): Promise<Layer1Response> {
  const res = await fetch(`${API_BASE}/layer1/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      sheetName,
      sheetType,
      reportingPeriod,
      ...(fieldsFilter && fieldsFilter.length > 0 ? { fieldsFilter } : {}),
    }),
  })
  return handleResponse<Layer1Response>(res)
}

// POST /layer1/run-pdf
export async function runLayer1Pdf(
  sessionId: string,
  pages: number[],
  statementType: string,
  reportingPeriod: string,
): Promise<Layer1Response> {
  const res = await fetch(`${API_BASE}/layer1/run-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, pages, statementType, reportingPeriod }),
  })
  return handleResponse<Layer1Response>(res)
}

// POST /layer2/run
// layer1_data is just the lineItems dict (not the full Layer1Result)
export async function runLayer2(request: Layer2Request): Promise<Layer2Result> {
  console.log(`[runLayer2] sending ${request.statement_type} request, layer1_data keys:`, Object.keys(request.layer1_data).length)
  const res = await fetch(`${API_BASE}/layer2/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: request.session_id ?? undefined,
      statement_type: request.statement_type,
      layer1_data: request.layer1_data,
      company_id: request.company_id ?? undefined,
      use_company_context: request.use_company_context ?? false,
    }),
  })
  console.log(`[runLayer2] ${request.statement_type} HTTP response: status=${res.status} ok=${res.ok} content-length=${res.headers.get('content-length')}`)
  const result = await handleResponse<Layer2Result>(res)
  console.log(`[runLayer2] ${request.statement_type} parsed result: statementType=${result?.statementType} values keys=${Object.keys(result?.values ?? {}).length} flaggedFields=${result?.flaggedFields?.length} fieldValidations keys=${Object.keys(result?.fieldValidations ?? {}).length}`)
  console.log(`[runLayer2] ${request.statement_type} full result:`, result)
  return result
}

// POST /corrections
export async function saveCorrection(payload: CorrectionRequest): Promise<void> {
  const res = await fetch(`${API_BASE}/corrections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: payload.sessionId ?? undefined,
      fieldName: payload.fieldName,
      statementType: payload.statementType,
      originalValue: payload.originalValue,
      correctedValue: payload.correctedValue,
      reasoning: payload.reasoning,
      tag: payload.tag,
    }),
  })
  await handleResponse<{ success: boolean }>(res)
}

// GET /template
export async function getTemplate(): Promise<TemplateResponse> {
  const res = await fetch(`${API_BASE}/template`)
  return handleResponse<TemplateResponse>(res)
}

// POST /finalize
export async function finalizeOutput(data: FinalizeRequest): Promise<FinalizeResponse> {
  const res = await fetch(`${API_BASE}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return handleResponse<FinalizeResponse>(res)
}

// GET /export/{session_id}/csv
export async function getExport(sessionId: string): Promise<ExportResponse> {
  const res = await fetch(`${API_BASE}/export/${encodeURIComponent(sessionId)}/csv`)
  return handleResponse<ExportResponse>(res)
}

// Build a full PDF URL from a relative path returned by the backend
export function buildPdfUrl(relativePath: string): string {
  return `${API_BASE}${relativePath}`
}

// GET /companies
export async function getCompanies(): Promise<Company[]> {
  const res = await fetch(`${API_BASE}/companies`)
  return handleResponse<Company[]>(res)
}

// POST /companies
export async function createCompany(name: string): Promise<Company> {
  const res = await fetch(`${API_BASE}/companies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return handleResponse<Company>(res)
}

// POST /corrections/process
export async function processCorrections(
  payload: CorrectionProcessRequest,
): Promise<CorrectionProcessResponse> {
  const res = await fetch(`${API_BASE}/corrections/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return handleResponse<CorrectionProcessResponse>(res)
}

// GET /companies/{id}/context-status
export async function getCompanyContextStatus(companyId: number): Promise<CompanyContextStatus> {
  const res = await fetch(`${API_BASE}/companies/${companyId}/context-status`)
  return handleResponse<CompanyContextStatus>(res)
}

// GET /reviews/check-existing
export async function checkExistingReview(companyId: number, reportingPeriod: string): Promise<{ exists: boolean; session_id?: string; finalized_at?: string | null }> {
  const params = new URLSearchParams({ company_id: String(companyId), reporting_period: reportingPeriod })
  const res = await fetch(`${API_BASE}/reviews/check-existing?${params}`)
  if (!res.ok) throw new Error('Failed to check existing review')
  return res.json()
}

// POST /reviews/continue-previous
export async function continuePreviousReview(companyId: number, reportingPeriod: string): Promise<{ session_id: string; company_name: string; reporting_period: string; layer1_data: unknown; layer2_data: unknown; corrections: unknown[] }> {
  const res = await fetch(`${API_BASE}/reviews/continue-previous`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_id: companyId, reporting_period: reportingPeriod }),
  })
  if (!res.ok) throw new Error('Failed to continue previous review')
  return res.json()
}

// POST /datasets/append
export async function appendToCompanyDataset(
  sessionId: string | null,
  companyName: string,
  reportingPeriod: string,
  layer1Results: Record<string, Layer1Result>,
): Promise<void> {
  const res = await fetch(`${API_BASE}/datasets/append`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      company_name: companyName,
      reporting_period: reportingPeriod,
      layer1_results: layer1Results,
    }),
  })
  await handleResponse<{ success: boolean }>(res)
}

// POST /recalculate
export async function recalculate(
  statementType: string,
  values: Record<string, number | null>,
  overrides: Record<string, number> = {},
): Promise<{ values: Record<string, number | null>; calculationMeta: Record<string, CalculationMeta>; flaggedFields: string[] }> {
  const res = await fetch(`${API_BASE}/recalculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ statement_type: statementType, values, overrides }),
  })
  return handleResponse(res)
}

// GET /companies/{id}/is-tab-config
export async function getISTabConfig(companyId: number): Promise<ISTabConfig> {
  const res = await fetch(`${API_BASE}/companies/${companyId}/is-tab-config`)
  return handleResponse(res)
}

// POST /companies/{id}/is-tab-config
export async function saveISTabConfig(companyId: number, config: ISTabConfig): Promise<void> {
  const res = await fetch(`${API_BASE}/companies/${companyId}/is-tab-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  await handleResponse<{ success: boolean }>(res)
}
