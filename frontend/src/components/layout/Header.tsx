import { useWizardState } from '../../hooks/useWizardState'

export default function Header() {
  const { companyName, reportingPeriod } = useWizardState()

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-pink-50 rounded flex items-center justify-center flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-5 h-5" fill="none">
            {/* Body */}
            <ellipse cx="12" cy="13" rx="7" ry="5.5" fill="#f9a8d4" />
            {/* Head */}
            <ellipse cx="18" cy="10" rx="3.2" ry="2.8" fill="#f9a8d4" />
            {/* Snout */}
            <ellipse cx="20.2" cy="10.8" rx="1.4" ry="1.1" fill="#f472b6" />
            <circle cx="19.8" cy="10.6" r="0.28" fill="#be185d" />
            <circle cx="20.6" cy="10.6" r="0.28" fill="#be185d" />
            {/* Ear */}
            <ellipse cx="16.6" cy="7.6" rx="1" ry="1.3" fill="#f472b6" />
            {/* Eye */}
            <circle cx="18.2" cy="9.2" r="0.35" fill="#1f2937" />
            {/* Legs */}
            <rect x="7"  y="17" width="2" height="2.5" rx="1" fill="#f472b6" />
            <rect x="10" y="17.5" width="2" height="2" rx="1" fill="#f472b6" />
            <rect x="13" y="17.5" width="2" height="2" rx="1" fill="#f472b6" />
            <rect x="16" y="17" width="2" height="2.5" rx="1" fill="#f472b6" />
            {/* Coin slot */}
            <rect x="10.5" y="7.8" width="3" height="0.7" rx="0.35" fill="#ec4899" />
            {/* Tail */}
            <path d="M5.2 12 C3.5 11 3.2 13.5 5 13" stroke="#f472b6" strokeWidth="0.9" fill="none" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <h1 className="text-sm font-semibold text-gray-900 leading-none">
            Henry
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
