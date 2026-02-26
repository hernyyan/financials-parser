import type {
  UploadResponse,
  Layer1Response,
  Layer2Request,
  Layer2Result,
  CorrectionRequest,
  FinalizeRequest,
  FinalizeResponse,
  ExportResponse,
  TemplateResponse,
  Company,
  CorrectionProcessRequest,
  CorrectionProcessResponse,
} from '../types'

export const API_BASE = 'http://localhost:8000'

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
  companyName: string,
  reportingPeriod: string,
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
): Promise<Layer1Response> {
  const res = await fetch(`${API_BASE}/layer1/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, sheetName, sheetType, reportingPeriod }),
  })
  return handleResponse<Layer1Response>(res)
}

// POST /layer2/run
// layer1_data is just the lineItems dict (not the full Layer1Result)
export async function runLayer2(request: Layer2Request): Promise<Layer2Result> {
  const res = await fetch(`${API_BASE}/layer2/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: request.session_id ?? undefined,
      statement_type: request.statement_type,
      layer1_data: request.layer1_data,
    }),
  })
  return handleResponse<Layer2Result>(res)
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
