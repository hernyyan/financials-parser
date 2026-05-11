/**
 * useStep2Classify — owns template loading and all derived data for Step 2.
 *
 * Hides:
 *   - template state + fetch useEffect (getTemplate)
 *   - fieldStatementMap useMemo (field → statement type mapping)
 *   - selectedCellType derivation
 *   - layer2 result references (isLayer2, bsLayer2, cfsLayer2)
 *   - hasBothResults gate
 *   - activeLayer2, existingCorrection lookups
 *   - isSections / bsSections / cfsSections fallback resolution
 *   - sourceIsRows / sourceBsRows / sourceCfsRows (buildSourceRows)
 *   - relevantSourceLabels (Set from activeLayer2.sourceLabels)
 *   - passCount / failCount / flaggedCount from allValidation
 *
 * The pendingValues → buildTemplateRows calls remain in the component because
 * pendingValues comes from useCorrections which itself needs selectedCellType —
 * extracting them here would create a circular dependency.
 */
import { useEffect, useMemo, useState } from 'react'
import { getTemplate } from '../api/client'
import { IS_TEMPLATE_FIELDS, BS_TEMPLATE_FIELDS } from '../mocks/mockData'
import { buildSourceRows } from '../utils/classifyRows'
import type { DataTableRow } from '../components/shared/DataTable'
import type {
  Correction,
  Layer1Result,
  Layer2Result,
  TemplateResponse,
  TemplateSection,
} from '../types'

interface UseStep2ClassifyOptions {
  selectedCell: string | null
  layer1Results: Record<string, Layer1Result>
  layer2Results: Record<string, Layer2Result>
  corrections: Correction[]
}

export interface Step2ClassifyData {
  template: TemplateResponse | null
  selectedCellType: 'income_statement' | 'balance_sheet' | 'cash_flow_statement' | null
  isLayer2: Layer2Result | null
  bsLayer2: Layer2Result | null
  cfsLayer2: Layer2Result | null
  hasBothResults: boolean
  activeLayer2: Layer2Result | null
  existingCorrection: Correction | undefined
  isSections: TemplateSection[]
  bsSections: TemplateSection[]
  cfsSections: TemplateSection[]
  sourceIsRows: DataTableRow[]
  sourceBsRows: DataTableRow[]
  sourceCfsRows: DataTableRow[]
  relevantSourceLabels: Set<string>
  passCount: number
  failCount: number
  flaggedCount: number
}

function buildFallbackSections(): { is: TemplateSection[]; bs: TemplateSection[] } {
  return {
    is: [{ header: null, fields: IS_TEMPLATE_FIELDS }],
    bs: [{ header: null, fields: BS_TEMPLATE_FIELDS }],
  }
}

export function useStep2Classify({
  selectedCell,
  layer1Results,
  layer2Results,
  corrections,
}: UseStep2ClassifyOptions): Step2ClassifyData {
  const [template, setTemplate] = useState<TemplateResponse | null>(null)

  useEffect(() => {
    getTemplate().then(setTemplate).catch(() => {})
  }, [])

  const isLayer2 = layer2Results['income_statement'] ?? null
  const bsLayer2 = layer2Results['balance_sheet'] ?? null
  const cfsLayer2 = layer2Results['cash_flow_statement'] ?? null

  const hasBothResults =
    !!isLayer2 && !!bsLayer2 && (!layer1Results['cash_flow_statement'] || !!cfsLayer2)

  const isAllFields = template?.income_statement.allFields ?? IS_TEMPLATE_FIELDS

  const fieldStatementMap = useMemo<Record<string, 'income_statement' | 'balance_sheet' | 'cash_flow_statement'>>(() => {
    const map: Record<string, 'income_statement' | 'balance_sheet' | 'cash_flow_statement'> = {}
    for (const f of (template?.balance_sheet.allFields ?? BS_TEMPLATE_FIELDS)) map[f] = 'balance_sheet'
    for (const f of (template?.cash_flow_statement?.allFields ?? [])) map[f] = 'cash_flow_statement'
    for (const f of isAllFields) map[f] = 'income_statement'
    return map
  }, [template])

  const selectedCellType: 'income_statement' | 'balance_sheet' | 'cash_flow_statement' | null =
    selectedCell ? (fieldStatementMap[selectedCell] ?? 'balance_sheet') : null

  const activeLayer2: Layer2Result | null = selectedCellType
    ? (layer2Results[selectedCellType] ?? null)
    : null

  const existingCorrection = selectedCell
    ? corrections.find((c) => c.fieldName === selectedCell)
    : undefined

  const { is: fallbackIs, bs: fallbackBs } = buildFallbackSections()
  const isSections = template?.income_statement.sections ?? fallbackIs
  const bsSections = template?.balance_sheet.sections ?? fallbackBs
  const cfsSections = template?.cash_flow_statement?.sections ?? []

  const isData = layer1Results['income_statement']
  const bsData = layer1Results['balance_sheet']
  const cfsData = layer1Results['cash_flow_statement']
  const sourceIsRows = isData ? buildSourceRows({ [isData.sourceSheet]: isData }) : []
  const sourceBsRows = bsData ? buildSourceRows({ [bsData.sourceSheet]: bsData }) : []
  const sourceCfsRows = cfsData ? buildSourceRows({ [cfsData.sourceSheet]: cfsData }) : []

  const relevantSourceLabels: Set<string> = useMemo(() => {
    if (!selectedCell || !activeLayer2) return new Set()
    const labels = activeLayer2.sourceLabels?.[selectedCell]
    return labels && labels.length > 0 ? new Set(labels) : new Set()
  }, [selectedCell, activeLayer2])

  const allValidation = { ...(isLayer2?.validation ?? {}), ...(bsLayer2?.validation ?? {}) }
  const passCount = Object.values(allValidation).filter((v) => v.status === 'PASS').length
  const failCount = Object.values(allValidation).filter((v) => v.status === 'FAIL').length
  const flaggedCount = [
    ...(isLayer2?.flaggedFields ?? []),
    ...(bsLayer2?.flaggedFields ?? []),
    ...(cfsLayer2?.flaggedFields ?? []),
  ].length

  return {
    template,
    selectedCellType,
    isLayer2,
    bsLayer2,
    cfsLayer2,
    hasBothResults,
    activeLayer2,
    existingCorrection,
    isSections,
    bsSections,
    cfsSections,
    sourceIsRows,
    sourceBsRows,
    sourceCfsRows,
    relevantSourceLabels,
    passCount,
    failCount,
    flaggedCount,
  }
}
