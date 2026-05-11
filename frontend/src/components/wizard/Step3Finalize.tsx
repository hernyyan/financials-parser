import { useWizardState } from '../../hooks/useWizardState'
import { useStep3Finalize } from '../../hooks/useStep3Finalize'
import FinalizeTable from './FinalizeTable'
import FinalizeActionBar from './FinalizeActionBar'
import {
  CheckCircle2,
  Edit3,
  Flag,
  Scale,
  XCircle,
} from 'lucide-react'

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Step3Finalize() {
  const {
    sessionId,
    companyName,
    reportingPeriod,
    layer2Results,
    corrections,
    backToStep2,
    resetWizard,
  } = useWizardState()

  const {
    saving,
    exporting,
    finalized,
    finalizedAt,
    status,
    rows,
    totalPopulated,
    flaggedRemaining,
    isBalanced,
    balanceDiff,
    handleFinalize,
    handleExportCsv,
  } = useStep3Finalize({ sessionId, companyName, reportingPeriod, layer2Results, corrections })

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <FinalizeActionBar
        finalized={finalized}
        saving={saving}
        exporting={exporting}
        onBack={backToStep2}
        onFinalize={handleFinalize}
        onExportCsv={handleExportCsv}
        onReset={resetWizard}
      />

      <div className="flex-1 overflow-auto px-4 py-3">
        {/* Error banner */}
        {status?.type === 'error' && (
          <div className="flex items-center gap-2 mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <XCircle className="w-4 h-4 text-red-500 shrink-0" />
            <p className="text-[13px] text-red-700">{status.message}</p>
          </div>
        )}

        {/* Success banner */}
        {finalized && finalizedAt && (
          <div className="flex items-center gap-2 mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            <div>
              <p className="text-[13px] text-emerald-700" style={{ fontWeight: 500 }}>
                Successfully finalized and saved for {companyName} — {reportingPeriod}
              </p>
              <p className="text-[11px] text-emerald-600">{formatDateTime(finalizedAt)}</p>
            </div>
          </div>
        )}

        {/* Summary stat cards */}
        <div className="grid grid-cols-4 gap-3 mb-3">
          <div className="p-3 rounded-lg border border-border bg-gray-50">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <p className="text-[11px] text-muted-foreground">Fields Populated</p>
            </div>
            <p className="text-[18px]" style={{ fontWeight: 600 }}>{totalPopulated}</p>
          </div>
          <div className="p-3 rounded-lg border border-border bg-gray-50">
            <div className="flex items-center gap-2 mb-1">
              <Edit3 className="w-4 h-4 text-purple-500" />
              <p className="text-[11px] text-muted-foreground">Corrections Made</p>
            </div>
            <p className="text-[18px]" style={{ fontWeight: 600 }}>{corrections.length}</p>
          </div>
          <div className="p-3 rounded-lg border border-border bg-gray-50">
            <div className="flex items-center gap-2 mb-1">
              <Flag className="w-4 h-4 text-amber-500" />
              <p className="text-[11px] text-muted-foreground">Flagged Remaining</p>
            </div>
            <p className="text-[18px]" style={{ fontWeight: 600 }}>{flaggedRemaining}</p>
          </div>
          <div className={`p-3 rounded-lg border ${isBalanced ? 'border-border bg-gray-50' : 'border-red-200 bg-red-50'}`}>
            <div className="flex items-center gap-2 mb-1">
              {isBalanced ? (
                <Scale className="w-4 h-4 text-emerald-500" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500" />
              )}
              <p className="text-[11px] text-muted-foreground">Balance Sheet Balances</p>
            </div>
            <p className="text-[18px]" style={{ fontWeight: 600 }}>{isBalanced ? 'Yes' : 'No'}</p>
          </div>
        </div>

        {/* Output table */}
        <FinalizeTable rows={rows} isBalanced={isBalanced} balanceDiff={balanceDiff} />
      </div>
    </div>
  )
}
