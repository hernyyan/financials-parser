import { useWizardState } from '../../hooks/useWizardState'

export default function Header() {
  const { companyName, reportingPeriod } = useWizardState()

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center text-xl leading-none">
          🪨
        </div>
        <div>
          <h1 className="text-sm font-semibold text-gray-900 leading-none">
            Rocky
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Portfolio Company Statement Processor</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {companyName && (
          <div className="text-right">
            <p className="text-sm font-semibold text-gray-800 leading-none">{companyName}</p>
            {reportingPeriod && (
              <p className="text-xs text-gray-400 mt-0.5">{reportingPeriod}</p>
            )}
          </div>
        )}
        <div className="text-xs text-gray-300">v0.1.0</div>
      </div>
    </header>
  )
}
