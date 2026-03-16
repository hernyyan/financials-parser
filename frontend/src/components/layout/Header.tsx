import { PiggyBank, Check } from 'lucide-react'
import { useWizardState } from '../../hooks/useWizardState'

const STEPS = ['Upload & Extract', 'Classify & Review', 'Finalize & Export']

export default function Header() {
  const { companyName, reportingPeriod, currentStep } = useWizardState()

  return (
    <div className="border-b border-border bg-white shrink-0">
      <div className="flex items-center justify-between px-5 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
            <PiggyBank className="w-5 h-5 text-white" />
          </div>
          <span className="text-[17px] tracking-tight" style={{ fontWeight: 600 }}>Henry Jr</span>
        </div>
        <div className="flex items-center gap-4 text-[13px] text-muted-foreground">
          {companyName && (
            <span className="bg-secondary px-2.5 py-1 rounded-md" style={{ fontWeight: 500 }}>
              {companyName}
            </span>
          )}
          {reportingPeriod && (
            <span className="bg-secondary px-2.5 py-1 rounded-md">{reportingPeriod}</span>
          )}
        </div>
      </div>
      <div className="flex items-center px-5 pb-0">
        {STEPS.map((step, i) => {
          const stepNum = i + 1
          const isActive = stepNum === currentStep
          const isComplete = stepNum < currentStep
          return (
            <div
              key={step}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors ${
                isComplete
                  ? 'border-emerald-500 text-emerald-600'
                  : !isActive
                  ? 'border-transparent text-muted-foreground'
                  : ''
              }`}
              style={isActive ? { borderBottomColor: '#030213', color: '#030213' } : {}}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] shrink-0 ${
                  isComplete
                    ? 'bg-emerald-500 text-white'
                    : !isActive
                    ? 'bg-muted text-muted-foreground'
                    : ''
                }`}
                style={{
                  fontWeight: 600,
                  ...(isActive ? { backgroundColor: '#030213', color: 'white' } : {}),
                }}
              >
                {isComplete ? <Check className="w-3 h-3" /> : stepNum}
              </div>
              <span
                className="text-[13px] whitespace-nowrap"
                style={{ fontWeight: isActive ? 500 : 400 }}
              >
                {step}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
