/**
 * ClassifyLoadingView — full-page loading screen for Step2Classify.
 *
 * Rendered as an early-return while classification is running and no
 * results are available yet. Shows per-statement progress cards and
 * elapsed time. Owns the loading UX completely.
 */
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'

interface ClassifyLoadingViewProps {
  stmtTypes: string[]
  stmtStatus: Record<string, string>
  stmtLabels: Record<string, string>
  layer1HasCfs: boolean
  elapsedSeconds: number
  onBack: () => void
}

export default function ClassifyLoadingView({
  stmtTypes,
  stmtStatus,
  stmtLabels,
  layer1HasCfs,
  elapsedSeconds,
  onBack,
}: ClassifyLoadingViewProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-4 py-2.5 border-b border-border bg-gray-50/80 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Extraction
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center pt-20">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <h2 className="text-[16px] mb-1" style={{ fontWeight: 600 }}>Classifying Financial Data</h2>
        <p className="text-[13px] text-muted-foreground mb-6">{elapsedSeconds}s elapsed</p>
        <div className="w-[300px] space-y-3">
          {stmtTypes
            .filter((key) => key !== 'cash_flow_statement' || layer1HasCfs)
            .map((key) => (
              <div
                key={key}
                className="flex items-center gap-3 p-3 border border-[#e2e8f0]"
                style={{ backgroundColor: '#f8fafc', borderRadius: '4px' }}
              >
                {stmtStatus[key] === 'done' ? (
                  <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: '#065f46' }} />
                ) : (
                  <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
                )}
                <div>
                  <p className="text-[13px]" style={{ fontWeight: 500 }}>{stmtLabels[key]}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {stmtStatus[key] === 'done' ? 'Classification complete' : 'Classifying line items...'}
                  </p>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
