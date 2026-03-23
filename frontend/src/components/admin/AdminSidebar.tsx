import { Building2, FileSpreadsheet, Wrench, History, AlertTriangle, ArrowLeft } from 'lucide-react'

export type AdminSection = 'companies' | 'reviews' | 'general-fixes' | 'changelog' | 'alerts'

const NAV_ITEMS: { id: AdminSection; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { id: 'companies', label: 'Companies', Icon: Building2 },
  { id: 'reviews', label: 'Reviews', Icon: FileSpreadsheet },
  { id: 'general-fixes', label: 'General Fixes', Icon: Wrench },
  { id: 'changelog', label: 'Changelog', Icon: History },
  { id: 'alerts', label: 'Alerts', Icon: AlertTriangle },
]

interface Props {
  active: AdminSection
  onChange: (section: AdminSection) => void
}

export default function AdminSidebar({ active, onChange }: Props) {
  return (
    <div className="w-[180px] shrink-0 bg-gray-50 border-r border-border flex flex-col h-full">
      <nav className="flex-1 py-3">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-left transition-colors ${
              active === id
                ? 'bg-white border-l-2 border-blue-500 text-foreground'
                : 'border-l-2 border-transparent text-muted-foreground hover:bg-gray-100'
            }`}
            style={{ fontWeight: active === id ? 500 : 400 }}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </button>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-border">
        <a
          href="/"
          className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Henry
        </a>
      </div>
    </div>
  )
}
