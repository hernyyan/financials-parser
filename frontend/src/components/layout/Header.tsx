import { PiggyBank, Check } from 'lucide-react'
import { useWizardState } from '../../hooks/useWizardState'

const STEPS = ['Upload & Extract', 'Classify & Review', 'Finalize & Export']

export default function Header() {
  const { companyName, reportingPeriod, currentStep } = useWizardState()

  return (
    <div className="border-b border-[#e2e8f0] bg-white shrink-0">
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-2">
          <PiggyBank className="w-4 h-4 text-[#1a1f35]" />
          <span className="text-[15px] tracking-[-0.5px] text-[#1a1f35]" style={{ fontWeight: 600 }}>
            Henry Jr
          </span>
        </div>
        <div className="flex items-center gap-4">
          {companyName && (
            <span className="text-[10px] uppercase tracking-[1.5px] text-[#64748b] flex items-center gap-1.5">
              <span className="text-[#e2e8f0]">◆</span>
              {companyName}
            </span>
          )}
          {reportingPeriod && (
            <span className="text-[10px] uppercase tracking-[1.5px] text-[#94a3b8]">
              {reportingPeriod}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center px-6 pb-0">
        {STEPS.map((step, i) => {
          const stepNum = i + 1
          const isActive = stepNum === currentStep
          const isComplete = stepNum < currentStep
          return (
            <div
              key={step}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors ${
                isComplete
                  ? 'border-[#065f46]'
                  : isActive
                  ? 'border-[#1a1f35] text-[#1a1f35]'
                  : 'border-transparent text-[#94a3b8]'
              }`}
              style={isComplete ? { color: '#065f46' } : {}}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] shrink-0 ${
                  isActive
                    ? 'bg-[#1a1f35] text-white'
                    : !isComplete
                    ? 'bg-[#f1f5f9] text-[#94a3b8]'
                    : ''
                }`}
                style={{
                  fontWeight: 600,
                  ...(isComplete ? { backgroundColor: '#d1fae5', color: '#065f46' } : {}),
                }}
              >
                {isComplete ? <Check className="w-3 h-3" /> : stepNum}
              </div>
              <span
                className="text-[12px] whitespace-nowrap"
                style={{ fontWeight: isActive ? 600 : 400 }}
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
