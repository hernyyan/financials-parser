import { API_BASE } from '../../api/client'

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text()
    let detail = text
    try { detail = JSON.parse(text).detail ?? text } catch {}
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

// ── Companies ──────────────────────────────────────────────────────────────

export interface AdminCompany {
  id: number
  name: string
  markdown_filename: string
  markdown_word_count: number
  markdown_file_size_bytes: number
  total_corrections: number
  processed_corrections: number
  pending_corrections: number
}

export async function adminGetCompanies(): Promise<AdminCompany[]> {
  const res = await fetch(`${API_BASE}/admin/companies`)
  return handleResponse(res)
}

export interface AdminCompanyContext {
  id: number
  name: string
  markdown_filename: string
  word_count: number
  content: string | null
}

export async function adminGetCompanyContext(id: number): Promise<AdminCompanyContext> {
  const res = await fetch(`${API_BASE}/admin/company-context/${id}`)
  return handleResponse(res)
}

export async function adminUpdateCompanyContext(id: number, content: string): Promise<{ success: boolean; word_count: number }> {
  const res = await fetch(`${API_BASE}/admin/company-context/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  return handleResponse(res)
}

export interface WriteRuleResult {
  success: boolean
  layer_a_instruction: string
  layer_a_referenced_fields: string[]
  layer_b_action: string
  layer_b_detail: string
  updated_markdown: string | null
}

export async function adminWriteRule(payload: {
  company_id: number
  field_name: string
  statement_type: string
  rule_text: string
}): Promise<WriteRuleResult> {
  const res = await fetch(`${API_BASE}/admin/write-rule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return handleResponse(res)
}

export interface CompanyPeriodData {
  session_id: string
  reporting_period: string
  layer1_data: Record<string, unknown> | null
  layer2_data: Record<string, unknown> | null
  status: string
  created_at: string | null
  finalized_at: string | null
}

export async function adminGetCompanyData(id: number): Promise<{ company_id: number; company_name: string; periods: CompanyPeriodData[] }> {
  const res = await fetch(`${API_BASE}/admin/company-data/${id}`)
  return handleResponse(res)
}

export interface AdminCorrection {
  id: number
  period: string
  statement_type: string
  field_name: string
  layer2_value: number | null
  corrected_value: number
  analyst_reasoning: string
  processed: boolean
  created_at: string | null
}

export async function adminGetCompanyCorrections(id: number): Promise<{ company_id: number; corrections: AdminCorrection[] }> {
  const res = await fetch(`${API_BASE}/admin/company-corrections/${id}`)
  return handleResponse(res)
}

// ── Reviews ────────────────────────────────────────────────────────────────

export interface AdminReview {
  id: number
  session_id: string
  company_name: string
  reporting_period: string
  status: string
  created_at: string
  finalized_at: string | null
  corrections_count: number
}

export async function adminGetReviews(params?: { status?: string; company?: string; limit?: number }): Promise<{ total: number; reviews: AdminReview[] }> {
  const query = new URLSearchParams()
  if (params?.status) query.set('status', params.status)
  if (params?.company) query.set('company', params.company)
  if (params?.limit) query.set('limit', String(params.limit))
  const res = await fetch(`${API_BASE}/admin/reviews?${query}`)
  return handleResponse(res)
}

export function adminExportReviewUrl(sessionId: string): string {
  return `${API_BASE}/admin/reviews/${sessionId}/export`
}

// ── General Fixes ──────────────────────────────────────────────────────────

export async function adminGetGeneralFixes(params?: { company?: string; limit?: number }): Promise<{ total_entries: number; entries: Record<string, string>[] }> {
  const query = new URLSearchParams()
  if (params?.company) query.set('company', params.company)
  if (params?.limit) query.set('limit', String(params.limit))
  const res = await fetch(`${API_BASE}/admin/general-fixes?${query}`)
  return handleResponse(res)
}

// ── Changelog ──────────────────────────────────────────────────────────────

export async function adminGetChangelog(params?: { company_id?: number; limit?: number }): Promise<{ total_entries: number; entries: Record<string, unknown>[] }> {
  const query = new URLSearchParams()
  if (params?.company_id) query.set('company_id', String(params.company_id))
  if (params?.limit) query.set('limit', String(params.limit))
  const res = await fetch(`${API_BASE}/admin/changelog?${query}`)
  return handleResponse(res)
}

// ── Alerts ─────────────────────────────────────────────────────────────────

export async function adminGetAlerts(resolved?: boolean): Promise<{ total_alerts: number; alerts: Record<string, unknown>[] }> {
  const query = new URLSearchParams()
  if (resolved !== undefined) query.set('resolved', String(resolved))
  const res = await fetch(`${API_BASE}/admin/alerts?${query}`)
  return handleResponse(res)
}
