/**
 * useCompanyDataTable — owns all data derivation for CompanyDataTable.
 *
 * Hides:
 *   - parseReportingPeriod  (financial "Month Year" → {year, month, key})
 *   - generateMonthRange    (start/end → ordered column descriptors)
 *   - periodByKey Map construction + min/max period detection
 *   - template load (useEffect + state)
 *   - label collection from template field order (L2) or L1 line item keys
 *   - getCellValue multi-path lookup (L1 tabs vs L2 statement values)
 *   - hasPeriod helper for gap styling
 *
 * Returns everything needed to render the view toggle, column headers,
 * row labels, and cell values.
 */
import { useEffect, useState } from 'react'
import { getTemplate } from '../api/client'
import type { CompanyPeriodData } from '../components/admin/AdminApiClient'
import type { TemplateResponse } from '../types'

// ── Private constants + pure helpers ─────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_SHORT  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

type ParsedPeriod = { year: number; month: number; key: string }

function parseReportingPeriod(period: string): ParsedPeriod | null {
  const months: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
    sep: 9, oct: 10, nov: 11, dec: 12,
  }
  const parts = period.trim().split(/[\s\-_]+/)
  if (parts.length < 2) return null
  let month: number | undefined
  let year: number | undefined
  for (const part of parts) {
    const asNum = parseInt(part)
    if (!isNaN(asNum) && asNum > 1900) { year = asNum; continue }
    const m = months[part.toLowerCase()]
    if (m) { month = m; continue }
  }
  if (!month || !year) return null
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}` }
}

export type ColumnDescriptor = { year: number; month: number; key: string; label: string; shortLabel: string }

function generateMonthRange(
  start: ParsedPeriod,
  end: ParsedPeriod,
): ColumnDescriptor[] {
  const result: ColumnDescriptor[] = []
  let y = start.year, m = start.month
  while (y < end.year || (y === end.year && m <= end.month)) {
    result.push({
      year: y, month: m,
      key: `${y}-${String(m).padStart(2, '0')}`,
      label: `${MONTH_NAMES[m - 1]} ${y}`,
      shortLabel: `${MONTH_SHORT[m - 1]} ${y}`,
    })
    m++
    if (m > 12) { m = 1; y++ }
  }
  return result
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export type DataView = 'l1' | 'l2'

export function useCompanyDataTable({ periods }: { periods: CompanyPeriodData[] }) {
  const [view, setView] = useState<DataView>('l2')
  const [template, setTemplate] = useState<TemplateResponse | null>(null)

  useEffect(() => {
    getTemplate().then(setTemplate).catch(console.error)
  }, [])

  // Build periodByKey + detect time range
  const periodByKey = new Map<string, CompanyPeriodData>()
  let minParsed: ParsedPeriod | null = null
  let maxParsed: ParsedPeriod | null = null

  for (const p of periods) {
    const parsed = parseReportingPeriod(p.reporting_period)
    if (!parsed) {
      console.warn('useCompanyDataTable: failed to parse period:', p.reporting_period)
      continue
    }
    periodByKey.set(parsed.key, p)
    if (!minParsed || parsed.key < minParsed.key) minParsed = parsed
    if (!maxParsed || parsed.key > maxParsed.key) maxParsed = parsed
  }

  const columns: ColumnDescriptor[] = (minParsed && maxParsed)
    ? generateMonthRange(minParsed, maxParsed)
    : []

  // Derive row labels: template field order for L2, union of L1 keys for L1
  let labels: string[] = []
  if (view === 'l2' && template) {
    for (const stmt of ['income_statement', 'balance_sheet', 'cash_flow_statement'] as const) {
      for (const section of template[stmt]?.sections ?? []) {
        for (const field of section.fields) {
          if (!labels.includes(field)) labels.push(field)
        }
      }
    }
  } else {
    const allKeys = new Set<string>()
    for (const p of periods) {
      const data = p.layer1_data
      if (!data) continue
      for (const tabKey of Object.keys(data as object)) {
        const tab = (data as Record<string, unknown>)[tabKey] as Record<string, unknown> | undefined
        const lineItems = tab?.lineItems as Record<string, unknown> | undefined
        if (lineItems) Object.keys(lineItems).forEach((k) => allKeys.add(k))
      }
    }
    labels = Array.from(allKeys)
  }

  function getCellValue(colKey: string, label: string): unknown {
    const p = periodByKey.get(colKey)
    if (!p) return null
    const data = view === 'l1' ? p.layer1_data : p.layer2_data
    if (!data) return null
    if (view === 'l1') {
      const d = data as Record<string, unknown>
      for (const tabKey of Object.keys(d)) {
        const tab = d[tabKey] as Record<string, unknown> | undefined
        const lineItems = tab?.lineItems as Record<string, unknown> | undefined
        if (lineItems && label in lineItems) return lineItems[label]
      }
      return null
    }
    const is = (data as Record<string, unknown>).income_statement as Record<string, unknown> | undefined
    const bs = (data as Record<string, unknown>).balance_sheet as Record<string, unknown> | undefined
    const cfs = (data as Record<string, unknown>).cash_flow_statement as Record<string, unknown> | undefined
    const isVals = is?.values as Record<string, unknown> | undefined
    const bsVals = bs?.values as Record<string, unknown> | undefined
    const cfsVals = cfs?.values as Record<string, unknown> | undefined
    return isVals?.[label] ?? bsVals?.[label] ?? cfsVals?.[label] ?? null
  }

  function hasPeriod(colKey: string): boolean {
    return periodByKey.has(colKey)
  }

  return { view, setView, columns, labels, getCellValue, hasPeriod }
}
