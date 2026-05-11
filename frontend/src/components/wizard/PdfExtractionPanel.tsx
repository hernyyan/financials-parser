import { Loader2 } from 'lucide-react'
import TabSelector from '../shared/TabSelector'
import Layer1ResultsTable from '../shared/Layer1ResultsTable'
import type { Layer1Result, StatementType } from '../../types'

const LABEL_FOR: Record<StatementType, string> = {
  income_statement: 'Income Statement',
  balance_sheet: 'Balance Sheet',
  cash_flow_statement: 'Cash Flow Statement',
}

const STMT_TAB_NAMES = ['Income Statement', 'Balance Sheet', 'Cash Flow Statement'] as const

const TAB_COLORS: Record<StatementType, string> = {
  income_statement: 'bg-blue-50 text-blue-700 border border-blue-200',
  balance_sheet: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  cash_flow_statement: 'bg-purple-50 text-purple-700 border border-purple-200',
}

function tabNameToStatementType(tab: string): StatementType {
  if (tab === 'Income Statement') return 'income_statement'
  if (tab === 'Balance Sheet') return 'balance_sheet'
  return 'cash_flow_statement'
}

interface PdfExtractionPanelProps {
  pdfActiveTab: StatementType
  pdfPageAssignments: Record<number, StatementType>
  pdfExtracting: Record<string, boolean>
  layer1Results: Record<string, Layer1Result>
  onSetActiveTab: (tab: StatementType) => void
  onRunAll: () => void
}

export default function PdfExtractionPanel({
  pdfActiveTab,
  pdfPageAssignments,
  pdfExtracting,
  layer1Results,
  onSetActiveTab,
  onRunAll,
}: PdfExtractionPanelProps) {
  const isRunning = Object.values(pdfExtracting).some(Boolean)
  const hasPages = Object.keys(pdfPageAssignments).length > 0

  const extractedTabs = (Object.keys(LABEL_FOR) as StatementType[])
    .filter((t) => layer1Results[t])
    .map((t) => LABEL_FOR[t])

  const assignedPagesForActive = Object.entries(pdfPageAssignments)
    .filter(([, type]) => type === pdfActiveTab)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([page]) => page)

  return (
    <div className="flex-1 flex flex-col min-w-[320px]">
      <div className="px-4 py-2.5 border-b border-border shrink-0">
        <button
          onClick={onRunAll}
          disabled={!hasPages || isRunning}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[13px] transition-colors disabled:opacity-50"
          style={{ backgroundColor: '#030213', color: 'white', fontWeight: 500 }}
        >
          {isRunning ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running...</>
          ) : (
            'Run Extraction'
          )}
        </button>
      </div>

      <TabSelector
        tabs={[...STMT_TAB_NAMES]}
        activeTab={LABEL_FOR[pdfActiveTab]}
        onChange={(tab) => onSetActiveTab(tabNameToStatementType(tab))}
        extractedTabs={extractedTabs}
        smallText
      />

      {layer1Results[pdfActiveTab] ? (
        <div className="flex-1 overflow-auto p-4">
          <Layer1ResultsTable result={layer1Results[pdfActiveTab]} />
        </div>
      ) : pdfExtracting[pdfActiveTab] ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#030213' }} />
          <p className="text-[13px] text-muted-foreground">
            Running AI extraction on selected pages...
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4">
          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">
              Select pages from the PDF that contain the {LABEL_FOR[pdfActiveTab]}, then click Run
              Extraction above.
            </p>
            {assignedPagesForActive.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {assignedPagesForActive.map((page) => (
                  <span
                    key={page}
                    className={`px-2 py-0.5 rounded text-[11px] ${TAB_COLORS[pdfActiveTab]}`}
                    style={{ fontWeight: 500 }}
                  >
                    Page {page}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
