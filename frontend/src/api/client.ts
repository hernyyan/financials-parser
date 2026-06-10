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
  SourceLayoutRow,
  LayoutCheckResult,
  StepCRow,
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
  companyId?: number | null,
): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('company_name', companyName)
  formData.append('reporting_period', reportingPeriod)
  if (companyId != null) formData.append('company_id', String(companyId))

  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  })
  return handleResponse<UploadResponse>(res)
}

// ── Async job polling ─────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 12 * 60 * 1000  // 12 min

interface _JobStartResponse { job_id: string }
interface _JobStatusResponse {
  job_id: string
  status: 'pending' | 'running' | 'done' | 'error'
  result?: Record<string, unknown>
  error?: string
}

/**
 * Poll a job status URL every 3s until status is 'done' or 'error'.
 * Calls onTick every ~1s with elapsed seconds so callers can update UI.
 * Internal — not exported.
 */
async function _pollJobUntilDone(
  pollUrl: string,
  onTick?: (elapsedSeconds: number) => void,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  const startTime = Date.now()
  const tickInterval = onTick
    ? setInterval(() => onTick(Math.floor((Date.now() - startTime) / 1000)), 1000)
    : null

  try {
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

      const res = await fetch(pollUrl)

      if (res.status === 404) {
        throw new Error('Extraction job not found — it may have expired. Please try again.')
      }
      if (!res.ok) {
        // Transient network error — keep polling rather than failing immediately
        console.warn(`[layer1 poll] non-OK status ${res.status}, retrying...`)
        continue
      }

      const data = (await res.json()) as _JobStatusResponse

      if (data.status === 'done') {
        if (!data.result) throw new Error('Job completed but returned no result.')
        return data.result
      }
      if (data.status === 'error') {
        throw new Error(data.error ?? 'Extraction failed with an unknown error.')
      }
      // status === 'pending' | 'running' — keep polling
    }

    throw new Error(
      `Extraction timed out after ${Math.round(POLL_TIMEOUT_MS / 60000)} minutes. Please try again.`
    )
  } finally {
    if (tickInterval !== null) clearInterval(tickInterval)
  }
}

// POST /layer1/run  (async — starts job, polls until done)
export async function runLayer1(
  sessionId: string,
  sheetName: string,
  sheetType: string,
  reportingPeriod: string,
  fieldsFilter?: string[],
  companyId?: number | null,
  sharedTab?: boolean,
  onElapsedTick?: (seconds: number) => void,
  explicitLabelCol?: number | null,
  explicitValueCol?: number | null,
): Promise<Layer1Response> {
  const startRes = await fetch(`${API_BASE}/layer1/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      sheetName,
      sheetType,
      reportingPeriod,
      ...(companyId != null ? { companyId } : {}),
      ...(fieldsFilter && fieldsFilter.length > 0 ? { fieldsFilter } : {}),
      ...(sharedTab ? { sharedTab: true } : {}),
      ...(explicitLabelCol != null ? { explicitLabelCol } : {}),
      ...(explicitValueCol != null ? { explicitValueCol } : {}),
    }),
  })
  const { job_id } = await handleResponse<_JobStartResponse>(startRes)
  const result = await _pollJobUntilDone(
    `${API_BASE}/layer1/jobs/${job_id}`,
    onElapsedTick,
  )
  return result as unknown as Layer1Response
}

// POST /layer1/run-pdf  (async — starts job, polls until done)
export async function runLayer1Pdf(
  sessionId: string,
  pages: number[],
  statementType: string,
  reportingPeriod: string,
  onElapsedTick?: (seconds: number) => void,
): Promise<Layer1Response> {
  const startRes = await fetch(`${API_BASE}/layer1/run-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, pages, statementType, reportingPeriod }),
  })
  const { job_id } = await handleResponse<_JobStartResponse>(startRes)
  const result = await _pollJobUntilDone(
    `${API_BASE}/layer1/jobs/${job_id}`,
    onElapsedTick,
  )
  return result as unknown as Layer1Response
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

// POST /companies/{id}/tab-preferences
export async function saveTabPreferences(
  companyId: number,
  preferences: Record<string, string>,
): Promise<void> {
  const res = await fetch(`${API_BASE}/companies/${companyId}/tab-preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  })
  await handleResponse<{ tab_preferences: Record<string, string> }>(res)
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
export async function checkExistingReview(companyId: number, reportingPeriod: string): Promise<ExistingReviewCheck> {
  const params = new URLSearchParams({ company_id: String(companyId), reporting_period: reportingPeriod })
  const res = await fetch(`${API_BASE}/reviews/check-existing?${params}`)
  if (!res.ok) throw new Error('Failed to check existing review')
  return res.json()
}

// GET /reviews/{session_id}/data
export async function getReviewData(sessionId: string): Promise<{
  layer1_data: Record<string, import('../types').Layer1Result>
  layer2_data: Record<string, import('../types').Layer2Result>
  company_name: string
  reporting_period: string
}> {
  const res = await fetch(`${API_BASE}/reviews/${encodeURIComponent(sessionId)}/data`)
  return handleResponse(res)
}

// POST /reviews/continue-previous
export async function continuePreviousReview(companyId: number, reportingPeriod: string): Promise<ContinuedReview> {
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
  const res = await fetch(`${API_BASE}/companies/${companyId}/layer1-templates/${statementType}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(template),
  })
  await handleResponse<{ success: boolean }>(res)
}

// DELETE /companies/{id}/layer1-templates/{statement_type}
export async function deleteLayer1Template(
  companyId: number,
  statementType: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/companies/${companyId}/layer1-templates/${statementType}`, {
    method: 'DELETE',
  })
  await handleResponse<{ success: boolean }>(res)
}

// POST /companies/{id}/layer1-templates/{statement_type}/check-layout
export async function checkLayout(
  companyId: number,
  statementType: string,
  layoutRows: SourceLayoutRow[],
): Promise<LayoutCheckResult> {
  const res = await fetch(
    `${API_BASE}/companies/${companyId}/layer1-templates/${statementType}/check-layout`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout_rows: layoutRows }),
    },
  )
  return handleResponse<LayoutCheckResult>(res)
}

// POST /companies/{id}/layer1-templates/{statement_type}/save-layout
export async function saveLayout(
  companyId: number,
  statementType: string,
  layoutRows: SourceLayoutRow[],
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/companies/${companyId}/layer1-templates/${statementType}/save-layout`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout_rows: layoutRows }),
    },
  )
  await handleResponse<{ success: boolean }>(res)
}

// POST /companies/{id}/layer1-templates/{statement_type}/apply-changes
export async function applyTemplateChanges(
  companyId: number,
  statementType: string,
  renames: Array<{ old_label: string; new_label: string }>,
  additions: string[],
  deletions: string[],
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/companies/${companyId}/layer1-templates/${statementType}/apply-changes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ renames, additions, deletions }),
    },
  )
  await handleResponse<{ success: boolean }>(res)
}

// POST /layer1/source-rows  (async — Steps A+B+C only, returns raw row list for template editor)
export async function extractSourceRows(
  sessionId: string,
  sheetName: string,
  sheetType: string,
  reportingPeriod: string,
  sharedTab?: boolean,
  onElapsedTick?: (s: number) => void,
  companyId?: number | null,
  explicitLabelCol?: number | null,
  explicitValueCol?: number | null,
): Promise<{ sourceRows: StepCRow[]; columnIdentified: string; sourceScaling: string; labelColLetter?: string; valueColLetter?: string }> {
  const startRes = await fetch(`${API_BASE}/layer1/source-rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId, sheetName, sheetType, reportingPeriod,
      sharedTab: sharedTab ?? false,
      companyId: companyId ?? null,
      explicitLabelCol: explicitLabelCol ?? null,
      explicitValueCol: explicitValueCol ?? null,
    }),
  })
  const { job_id } = await handleResponse<_JobStartResponse>(startRes)
  const result = await _pollJobUntilDone(`${API_BASE}/layer1/jobs/${job_id}`, onElapsedTick)
  return result as any
}

// POST /layer1/run-deterministic  (async — starts job, polls until done)
export async function runLayer1Deterministic(
  sessionId: string,
  sheetName: string,
  sheetType: string,
  reportingPeriod: string,
  companyId: number,
  template: Layer1Template,
  sharedTab?: boolean,
  onElapsedTick?: (seconds: number) => void,
): Promise<Layer1Response> {
  const startRes = await fetch(`${API_BASE}/layer1/run-deterministic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      sheetName,
      sheetType,
      reportingPeriod,
      companyId,
      template,
      sharedTab: sharedTab ?? false,
    }),
  })
  const { job_id } = await handleResponse<_JobStartResponse>(startRes)
  const result = await _pollJobUntilDone(
    `${API_BASE}/layer1/jobs/${job_id}`,
    onElapsedTick,
  )
  return result as unknown as Layer1Response
}

