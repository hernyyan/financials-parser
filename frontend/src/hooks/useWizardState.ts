import { createContext, useContext, useState, ReactNode, createElement } from 'react'
import type { WizardState, Layer1Result, Layer2Result, Correction } from '../types'
import {
  MOCK_LAYER2_INCOME_STATEMENT,
  MOCK_LAYER2_BALANCE_SHEET,
} from '../mocks/mockData'
import { appendToCompanyDataset } from '../api/client'

interface WizardContextType extends WizardState {
  setCompanyName: (name: string) => void
  setCompanyId: (id: number | null) => void
  setReportingPeriod: (period: string) => void
  setSessionId: (id: string | null) => void
  setUploadedFile: (file: File | null) => void
  setSheetNames: (names: string[]) => void
  setWorkbookUrl: (url: string | null) => void
  setLayer1Results: (results: Record<string, Layer1Result>) => void
  mergeLayer1Result: (statementType: string, result: Layer1Result) => void
  approveStep1: () => void
  setLayer2Results: (results: Record<string, Layer2Result>) => void
  addCorrection: (correction: Correction) => void
  removeCorrection: (fieldName: string) => void
  approveStep2: () => void
  backToStep1: () => void
  backToStep2: () => void
  setActiveSheetTab: (tab: string) => void
  setSelectedCell: (cell: string | null) => void
  setSidePanelOpen: (open: boolean) => void
  setUseCompanyContext: (enabled: boolean) => void
  setUploadFileType: (type: 'excel' | 'pdf' | null) => void
  setPdfPageCount: (count: number) => void
  setPdfUrl: (url: string | null) => void
  setPdfPageAssignments: (assignments: Record<number, 'income_statement' | 'balance_sheet' | 'cash_flow_statement'>) => void
  setFieldTabAssignments: (assignments: Record<string, Record<string, string>>) => void
  resetWizard: () => void
  loadMockStep2: () => void
}

const defaultState: WizardState = {
  companyName: '',
  companyId: null,
  reportingPeriod: '',
  sessionId: null,
  uploadFileType: null,
  uploadedFile: null,
  sheetNames: [],
  workbookUrl: null,
  layer1Results: {},
  step1Approved: false,
  useCompanyContext: true,
  pdfPageCount: 0,
  pdfUrl: null,
  pdfPageAssignments: {},
  layer2Results: {},
  corrections: [],
  step2Approved: false,
  fieldTabAssignments: {},
  currentStep: 1,
  activeSheetTab: '',
  selectedCell: null,
  sidePanelOpen: false,
}

const WizardContext = createContext<WizardContextType | null>(null)

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WizardState>(defaultState)

  function setCompanyName(name: string) {
    setState((s) => ({ ...s, companyName: name }))
  }

  function setCompanyId(id: number | null) {
    setState((s) => ({ ...s, companyId: id }))
  }

  function setReportingPeriod(period: string) {
    setState((s) => ({ ...s, reportingPeriod: period }))
  }

  function setSessionId(id: string | null) {
    setState((s) => ({ ...s, sessionId: id }))
  }

  function setUploadedFile(file: File | null) {
    setState((s) => ({ ...s, uploadedFile: file }))
  }

  function setSheetNames(names: string[]) {
    setState((s) => ({
      ...s,
      sheetNames: names,
      activeSheetTab: names[0] ?? '',
    }))
  }

  function setWorkbookUrl(url: string | null) {
    setState((s) => ({ ...s, workbookUrl: url }))
  }

  function setLayer1Results(results: Record<string, Layer1Result>) {
    setState((s) => ({ ...s, layer1Results: results }))
  }

  function mergeLayer1Result(statementType: string, result: Layer1Result) {
    setState((s) => ({
      ...s,
      layer1Results: {
        ...s.layer1Results,
        [statementType]: result,
      },
    }))
  }

  function approveStep1() {
    setState((s) => {
      // Fire the dataset append (non-blocking, fire-and-forget)
      if (s.companyName && s.reportingPeriod && Object.keys(s.layer1Results).length > 0) {
        appendToCompanyDataset(
          s.sessionId,
          s.companyName,
          s.reportingPeriod,
          s.layer1Results,
        ).catch((err) => console.error('Dataset append failed:', err))
      }

      return { ...s, step1Approved: true, currentStep: 2 }
    })
  }

  function setLayer2Results(results: Record<string, Layer2Result>) {
    setState((s) => ({ ...s, layer2Results: results }))
  }

  function addCorrection(correction: Correction) {
    setState((s) => {
      const existing = s.corrections.findIndex((c) => c.fieldName === correction.fieldName)
      if (existing >= 0) {
        const updated = [...s.corrections]
        updated[existing] = correction
        return { ...s, corrections: updated }
      }
      return { ...s, corrections: [...s.corrections, correction] }
    })
  }

  function removeCorrection(fieldName: string) {
    setState((s) => ({
      ...s,
      corrections: s.corrections.filter((c) => c.fieldName !== fieldName),
    }))
  }

  function approveStep2() {
    setState((s) => ({
      ...s,
      step2Approved: true,
      currentStep: 3,
      sidePanelOpen: false,
      selectedCell: null,
    }))
  }

  function backToStep1() {
    setState((s) => ({
      ...s,
      currentStep: 1,
      step1Approved: false,
      layer1Results: {},
      layer2Results: {},
      corrections: [],
      step2Approved: false,
      sidePanelOpen: false,
      selectedCell: null,
      uploadFileType: null,
      pdfPageCount: 0,
      pdfUrl: null,
      pdfPageAssignments: {},
    }))
  }

  function backToStep2() {
    setState((s) => ({
      ...s,
      currentStep: 2,
      step2Approved: false,
    }))
  }

  function setActiveSheetTab(tab: string) {
    setState((s) => ({ ...s, activeSheetTab: tab }))
  }

  function setSelectedCell(cell: string | null) {
    setState((s) => ({
      ...s,
      selectedCell: cell,
      sidePanelOpen: cell !== null,
    }))
  }

  function setSidePanelOpen(open: boolean) {
    setState((s) => ({
      ...s,
      sidePanelOpen: open,
      selectedCell: open ? s.selectedCell : null,
    }))
  }

  function setUseCompanyContext(enabled: boolean) {
    setState((s) => ({ ...s, useCompanyContext: enabled }))
  }

  function setUploadFileType(type: 'excel' | 'pdf' | null) {
    setState((s) => ({ ...s, uploadFileType: type }))
  }

  function setPdfPageCount(count: number) {
    setState((s) => ({ ...s, pdfPageCount: count }))
  }

  function setPdfUrl(url: string | null) {
    setState((s) => ({ ...s, pdfUrl: url }))
  }

  function setPdfPageAssignments(assignments: Record<number, 'income_statement' | 'balance_sheet' | 'cash_flow_statement'>) {
    setState((s) => ({ ...s, pdfPageAssignments: assignments }))
  }

  function setFieldTabAssignments(assignments: Record<string, Record<string, string>>) {
    setState((s) => ({ ...s, fieldTabAssignments: assignments }))
  }

  function resetWizard() {
    setState(defaultState)
  }

  // Load mock data for Step 2/3 development — bypasses Step 1 real upload flow
  function loadMockStep2() {
    setState({
      companyName: 'Business Enterprise Company',
      companyId: null,
      reportingPeriod: 'February 2026',
      sessionId: 'mock-session-001',
      uploadFileType: null,
      uploadedFile: null,
      sheetNames: ['Income Statement', 'Balance Sheet'],
      workbookUrl: null,
      layer1Results: {},
      step1Approved: true,
      useCompanyContext: true,
      pdfPageCount: 0,
      pdfUrl: null,
      pdfPageAssignments: {},
      layer2Results: {
        income_statement: MOCK_LAYER2_INCOME_STATEMENT,
        balance_sheet: MOCK_LAYER2_BALANCE_SHEET,
      },
      corrections: [],
      step2Approved: false,
      fieldTabAssignments: {},
      currentStep: 2,
      activeSheetTab: 'Income Statement',
      selectedCell: null,
      sidePanelOpen: false,
    })
  }

  const value: WizardContextType = {
    ...state,
    setCompanyName,
    setCompanyId,
    setReportingPeriod,
    setSessionId,
    setUploadedFile,
    setSheetNames,
    setWorkbookUrl,
    setLayer1Results,
    mergeLayer1Result,
    approveStep1,
    setLayer2Results,
    addCorrection,
    removeCorrection,
    approveStep2,
    backToStep1,
    backToStep2,
    setActiveSheetTab,
    setSelectedCell,
    setSidePanelOpen,
    setUseCompanyContext,
    setUploadFileType,
    setPdfPageCount,
    setPdfUrl,
    setPdfPageAssignments,
    setFieldTabAssignments,
    resetWizard,
    loadMockStep2,
  }

  return createElement(WizardContext.Provider, { value }, children)
}

export function useWizardState(): WizardContextType {
  const ctx = useContext(WizardContext)
  if (!ctx) throw new Error('useWizardState must be used within WizardProvider')
  return ctx
}
