interface StepIndicatorProps {
  currentStep: 1 | 2 | 3
}

const STEPS = [
  { number: 1, label: 'Upload & Extract' },
  { number: 2, label: 'Load & Edit' },
  { number: 3, label: 'Finalize' },
]

export default function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center px-8 py-3 bg-white border-b border-gray-200 flex-shrink-0">
      <div className="flex items-center gap-0">
        {STEPS.map((step, idx) => {
          const isDone = step.number < currentStep
          const isActive = step.number === currentStep
          const isUpcoming = step.number > currentStep

          return (
            <div key={step.number} className="flex items-center">
              {/* Step circle + label */}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                    isDone
                      ? 'bg-green-500 text-white'
                      : isActive
                      ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {isDone ? '✓' : step.number}
                </div>
                <span
                  className={`text-[10px] font-medium whitespace-nowrap ${
                    isActive
                      ? 'text-blue-600'
                      : isDone
                      ? 'text-green-600'
                      : isUpcoming
                      ? 'text-gray-400'
                      : ''
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line between steps */}
              {idx < STEPS.length - 1 && (
                <div
                  className={`w-24 h-0.5 mx-2 mb-4 transition-colors ${
                    step.number < currentStep ? 'bg-green-400' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
