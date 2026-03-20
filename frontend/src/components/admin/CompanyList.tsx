import { useEffect, useState } from 'react'
import { Search, Building2, Loader2 } from 'lucide-react'
import { adminGetCompanies, AdminCompany } from './AdminApiClient'

interface Props {
  onSelect: (id: number) => void
}

export default function CompanyList({ onSelect }: Props) {
  const [companies, setCompanies] = useState<AdminCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    adminGetCompanies()
      .then(setCompanies)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filtered = companies.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-[15px]" style={{ fontWeight: 600 }}>Companies</h2>
        <span className="text-[12px] text-muted-foreground">{companies.length} total</span>
      </div>

      <div className="flex items-center gap-2 bg-white border border-border rounded-lg px-3 py-1.5 mb-5 max-w-sm">
        <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <input
          className="bg-transparent outline-none text-[13px] flex-1"
          placeholder="Search companies..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {filtered.map((c) => (
            <div
              key={c.id}
              onClick={() => onSelect(c.id)}
              className="flex items-center gap-4 px-4 py-3 bg-white border border-border rounded-lg hover:border-gray-300 hover:shadow-sm cursor-pointer transition-all"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className={`w-2 h-2 rounded-full shrink-0 ${c.markdown_word_count > 0 ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-[13px] truncate" style={{ fontWeight: 500 }}>{c.name}</span>
              </div>
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground shrink-0">
                <span>{c.markdown_word_count} words</span>
                <span>{c.total_corrections} corrections</span>
                {c.pending_corrections > 0 && (
                  <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-[10px]" style={{ fontWeight: 500 }}>
                    {c.pending_corrections} pending
                  </span>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-[13px] text-muted-foreground py-8 text-center">No companies match "{search}"</p>
          )}
        </div>
      )}
    </div>
  )
}
