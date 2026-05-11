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
  ExistingReviewCheck,
  ContinuedReview,
  Layer1Template,
} from '../types'

export const API_BASE = import.meta.env.VITE_API_URL || '/api'

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleResponse<T>(res)
}

export async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleResponse<T>(res)
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  return handleResponse<T>(res)
}

export async function deleteJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' })
  return handleResponse<T>(res)
}

export async function handleResponse<T>(res: Response): Promise<T> {
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
  companyId?: number | null,
  sharedTab?: boolean,
): Promise<Layer1Response> {
  return postJson<Layer1Response>(`${API_BASE}/layer1/run`, {
    sessionId,
    sheetName,
    sheetType,
    reportingPeriod,
    ...(companyId != null ? { companyId } : {}),
    ...(fieldsFilter && fieldsFilter.length > 0 ? { fieldsFilter } : {}),
    ...(sharedTab ? { sharedTab: true } : {}),
  })
}

// POST /layer1/run-pdf
export async function runLayer1Pdf(
  sessionId: string,
  pages: number[],
  statementType: string,
  reportingPeriod: string,
): Promise<Layer1Response> {
  return postJson<Layer1Response>(`${API_BASE}/layer1/run-pdf`, { sessionId, pages, statementType, reportingPeriod })
}

// POST /layer2/run
// layer1_data is just the lineItems dict (not the full Layer1Result)
export async function runLayer2(request: Layer2Request): Promise<Layer2Result> {
  return postJson<Layer2Result>(`${API_BASE}/layer2/run`, {
    session_id: request.session_id ?? undefined,
    statement_type: request.statement_type,
    layer1_data: request.layer1_data,
    company_id: request.company_id ?? undefined,
    use_company_context: request.use_company_context ?? false,
  })
}

// POST /corrections
export async function saveCorrection(payload: CorrectionRequest): Promise<void> {
  await postJson<{ success: boolean }>(`${API_BASE}/corrections`, {
    sessionId: payload.sessionId ?? undefined,
    fieldName: payload.fieldName,
    statementType: payload.statementType,
    originalValue: payload.originalValue,
    correctedValue: payload.correctedValue,
    reasoning: payload.reasoning,
    tag: payload.tag,
  })
}

// GET /template
export async function getTemplate(): Promise<TemplateResponse> {
  return getJson<TemplateResponse>(`${API_BASE}/template`)
}

// POST /finalize
export async function finalizeOutput(data: FinalizeRequest): Promise<FinalizeResponse> {
  return postJson<FinalizeResponse>(`${API_BASE}/finalize`, data)
}

// GET /export/{session_id}/csv
export async function getExport(sessionId: string): Promise<ExportResponse> {
  return getJson<ExportResponse>(`${API_BASE}/export/${encodeURIComponent(sessionId)}/csv`)
}

// Build a full PDF URL from a relative path returned by the backend
export function buildPdfUrl(relativePath: string): string {
  return `${API_BASE}${relativePath}`
}

// GET /companies
export async function getCompanies(): Promise<Company[]> {
  return getJson<Company[]>(`${API_BASE}/companies`)
}

// POST /companies
export async function createCompany(name: string): Promise<Company> {
  return postJson<Company>(`${API_BASE}/companies`, { name })
}

// POST /corrections/process
export async function processCorrections(
  payload: CorrectionProcessRequest,
): Promise<CorrectionProcessResponse> {
  return postJson<CorrectionProcessResponse>(`${API_BASE}/corrections/process`, payload)
}

// GET /companies/{id}/context-status
export async function getCompanyContextStatus(companyId: number): Promise<CompanyContextStatus> {
  return getJson<CompanyContextStatus>(`${API_BASE}/companies/${companyId}/context-status`)
}

// GET /reviews/check-existing
export async function checkExistingReview(companyId: number, reportingPeriod: string): Promise<ExistingReviewCheck> {
  const params = new URLSearchParams({ company_id: String(companyId), reporting_period: reportingPeriod })
  return getJson<ExistingReviewCheck>(`${API_BASE}/reviews/check-existing?${params}`)
}

// POST /reviews/continue-previous
export async function continuePreviousReview(companyId: number, reportingPeriod: string): Promise<ContinuedReview> {
  return postJson<ContinuedReview>(`${API_BASE}/reviews/continue-previous`, { company_id: companyId, reporting_period: reportingPeriod })
}

// POST /datasets/append
export async function appendToCompanyDataset(
  sessionId: string | null,
  companyName: string,
  reportingPeriod: string,
  layer1Results: Record<string, Layer1Result>,
): Promise<void> {
  await postJson<{ success: boolean }>(`${API_BASE}/datasets/append`, {
    session_id: sessionId,
    company_name: companyName,
    reporting_period: reportingPeriod,
    layer1_results: layer1Results,
  })
}

// POST /recalculate
export async function recalculate(
  statementType: string,
  values: Record<string, number | null>,
  overrides: Record<string, number> = {},
): Promise<{ values: Record<string, number | null>; calculationMeta: Record<string, CalculationMeta>; flaggedFields: string[] }> {
  return postJson(`${API_BASE}/recalculate`, { statement_type: statementType, values, overrides })
}

// GET /companies/{id}/layer1-templates/{statement_type}
export async function getLayer1Template(
  companyId: number,
  statementType: string,
): Promise<Layer1Template | null> {
  const res = await fetch(`${API_BASE}/companies/${companyId}/layer1-templates/${statementType}`)
  if (res.status === 404) return null
  return handleResponse<{ template: Layer1Template }>(res).then(r => r.template)
}

// POST /companies/{id}/layer1-templates/{statement_type}
export async function saveLayer1Template(
  companyId: number,
  statementType: string,
  template: Layer1Template,
): Promise<void> {
  await postJson<{ success: boolean }>(`${API_BASE}/companies/${companyId}/layer1-templates/${statementType}`, template)
}

