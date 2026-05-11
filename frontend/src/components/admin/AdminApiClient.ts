import { API_BASE, getJson, deleteJson, postJson, putJson } from '../../api/client'

// ── Companies ──────────────────────────────────────────────────────────────

export interface AdminCompany {
  id: number
  name: string
  context_word_count: number
  total_corrections: number
  processed_corrections: number
  pending_corrections: number
}

export function adminGetCompanies(): Promise<AdminCompany[]> {
  return getJson(`${API_BASE}/admin/companies`)
}

export interface AdminCompanyContext {
  id: number
  name: string
  word_count: number
  content: string | null
}

export function adminGetCompanyContext(id: number): Promise<AdminCompanyContext> {
  return getJson(`${API_BASE}/admin/company-context/${id}`)
}

export function adminUpdateCompanyContext(id: number, content: string): Promise<{ success: boolean; word_count: number }> {
  return putJson(`${API_BASE}/admin/company-context/${id}`, { content })
}

export interface WriteRuleResult {
  success: boolean
  layer_a_instruction: string
  layer_a_referenced_fields: string[]
  layer_b_action: string
  layer_b_detail: string
  updated_markdown: string | null
}

export function adminWriteRule(payload: {
  company_id: number
  field_name: string
  statement_type: string
  rule_text: string
}): Promise<WriteRuleResult> {
  return postJson(`${API_BASE}/admin/write-rule`, payload)
}

export interface CompanyPeriodData {
  session_id: string
  reporting_period: string
  layer1_data: Record<string, unknown> | null
  layer2_data: Record<string, unknown> | null
  finalized_at: string | null
  status: string | null
  created_at: string | null
}

export function adminGetCompanyData(id: number): Promise<{ company_id: number; company_name: string; periods: CompanyPeriodData[] }> {
  return getJson(`${API_BASE}/admin/company-data/${id}`)
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

export function adminGetCompanyCorrections(id: number): Promise<{ company_id: number; corrections: AdminCorrection[] }> {
  return getJson(`${API_BASE}/admin/company-corrections/${id}`)
}

export function adminRenameCompany(id: number, name: string): Promise<{ success: boolean; old_name: string; new_name: string }> {
  return putJson(`${API_BASE}/admin/companies/${id}/rename`, { name })
}

export function adminCreateCompany(name: string): Promise<{ id: number; name: string }> {
  return postJson(`${API_BASE}/admin/companies`, { name })
}

export function adminDeleteCompany(id: number): Promise<{ success: boolean; deleted_company: string }> {
  return deleteJson(`${API_BASE}/admin/companies/${id}`)
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

export function adminGetReviews(params?: { status?: string; company?: string; limit?: number }): Promise<{ total: number; reviews: AdminReview[] }> {
  const query = new URLSearchParams()
  if (params?.status) query.set('status', params.status)
  if (params?.company) query.set('company', params.company)
  if (params?.limit) query.set('limit', String(params.limit))
  return getJson(`${API_BASE}/admin/reviews?${query}`)
}

export function adminExportReviewUrl(sessionId: string): string {
  return `${API_BASE}/admin/reviews/${sessionId}/export`
}

export function adminDeleteReview(sessionId: string): Promise<{ success: boolean; deleted_session_id: string }> {
  return deleteJson(`${API_BASE}/admin/reviews/${sessionId}`)
}

// ── General Fixes ──────────────────────────────────────────────────────────

export function adminGetGeneralFixes(params?: { company?: string; limit?: number }): Promise<{ total_entries: number; entries: Record<string, string>[] }> {
  const query = new URLSearchParams()
  if (params?.company) query.set('company', params.company)
  if (params?.limit) query.set('limit', String(params.limit))
  return getJson(`${API_BASE}/admin/general-fixes?${query}`)
}

// ── Changelog ──────────────────────────────────────────────────────────────

export function adminGetChangelog(params?: { company_id?: number; limit?: number }): Promise<{ total_entries: number; entries: Record<string, unknown>[] }> {
  const query = new URLSearchParams()
  if (params?.company_id) query.set('company_id', String(params.company_id))
  if (params?.limit) query.set('limit', String(params.limit))
  return getJson(`${API_BASE}/admin/changelog?${query}`)
}

// ── Alerts ─────────────────────────────────────────────────────────────────

export function adminGetAlerts(status: string = 'open'): Promise<{ total_alerts: number; alerts: Record<string, unknown>[] }> {
  const params = new URLSearchParams({ status })
  return getJson(`${API_BASE}/admin/alerts?${params}`)
}

export function adminUpdateAlertStatus(index: number, newStatus: string): Promise<{ success: boolean; index: number; new_status: string }> {
  return putJson(`${API_BASE}/admin/alerts/update-status`, { index, new_status: newStatus })
}
