import { Loader2 } from 'lucide-react'

const STATEMENT_TYPES = [
  { key: 'income_statement', label: 'Income Statement' },
  { key: 'balance_sheet', label: 'Balance Sheet' },
  { key: 'cash_flow_statement', label: 'Cash Flow Statement' },
] as const

interface ExcelSheetAssignmentPanelProps {
  sheetNames: string[]
  assignments: Record<string, string>
  extractionStatus: string
  extractionError: string | null
  canRunExtraction: boolean
  onAssign: (stmtType: string, tab: string) => void
  onRun: () => void
}

export default function ExcelSheetAssignmentPanel({
  sheetNames,
  assignments,
  extractionStatus,
  extractionError,
  canRunExtraction,
  onAssign,
  onRun,
}: ExcelSheetAssignmentPanelProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-[320px] bg-white">
      <div
        className="shrink-0 px-[14px] py-2.5 border-b border-gray-200 bg-white"
        style={{ position: 'sticky', top: 0, zIndex: 10 }}
      >
        <p className="text-[11px] text-muted-foreground">
          Assign one sheet per statement, then run extraction
        </p>
      </div>

      <div className="shrink-0 px-[14px] py-2.5 border-b border-border">
        <button
          onClick={onRun}
          disabled={!canRunExtraction}
          className="w-full flex items-center justify-center gap-2 rounded-lg text-[13px] transition-colors disabled:opacity-50"
          style={{ backgroundColor: '#030213', color: 'white', fontWeight: 500, padding: '8px 0', borderRadius: 8 }}
        >
          {extractionStatus === 'running' ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Running...
            </>
          ) : (
            'Run Extraction'
          )}
        </button>
        {extractionError && (
          <p className="text-[11px] text-red-600 mt-1.5">{extractionError}</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {STATEMENT_TYPES.map(({ key, label }) => (
          <div key={key} className="border-b border-gray-200 px-[14px] py-3">
            <p
              className="text-muted-foreground uppercase mb-2"
              style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.05em' }}
            >
              {label}
            </p>
            {sheetNames.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">
                Upload a file to assign a sheet
              </p>
            ) : (
              <div
                className="border border-gray-200 rounded-lg overflow-y-auto"
                style={{ maxHeight: 130 }}
              >
                {sheetNames.map((tab) => {
                  const selected = assignments[key] === tab
                  return (
                    <label
                      key={tab}
                      className="flex items-center gap-2 cursor-pointer border-b border-gray-100 last:border-b-0"
                      style={{
                        padding: '5px 9px',
                        background: selected ? '#eff6ff' : undefined,
                        color: selected ? '#1d4ed8' : undefined,
                      }}
                    >
                      <input
                        type="radio"
                        name={key}
                        checked={selected}
                        onChange={() => onAssign(key, tab)}
                        style={{ accentColor: '#185FA5', width: 13, height: 13, flexShrink: 0 }}
                      />
                      <span className="truncate text-[12px]">{tab}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
