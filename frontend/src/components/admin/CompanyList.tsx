import { useEffect, useRef, useState } from 'react'
import { Search, Building2, Loader2, Plus, Check, X, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { adminGetCompanies, adminCreateCompany, adminDeleteCompany, AdminCompany } from './AdminApiClient'

type SortField = 'name' | 'markdown_word_count' | 'total_corrections' | 'last_modified'

interface Props {
  onSelect: (id: number) => void
}

export default function CompanyList({ onSelect }: Props) {
  const [companies, setCompanies] = useState<AdminCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [addText, setAddText] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    adminGetCompanies()
      .then(setCompanies)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  function startAdding() {
    setAddText('')
    setAdding(true)
    setTimeout(() => addInputRef.current?.focus(), 0)
  }

  function cancelAdding() {
    setAdding(false)
    setAddText('')
  }

  async function handleCreate() {
    if (!addText.trim() || addSaving) return
    setAddSaving(true)
    try {
      const created = await adminCreateCompany(addText.trim())
      setCompanies((prev) => [...prev, {
        id: created.id,
        name: created.name,
        markdown_filename: created.markdown_filename,
        markdown_word_count: 0,
        markdown_file_size_bytes: 0,
        total_corrections: 0,
        processed_corrections: 0,
        pending_corrections: 0,
        last_modified: null,
      }])
      setAdding(false)
      setAddText('')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create company')
    } finally {
      setAddSaving(false)
    }
  }

  async function handleDelete(e: React.MouseEvent, company: AdminCompany) {
    e.stopPropagation()
    if (!window.confirm(`Delete ${company.name} and all its context data? This cannot be undone.`)) return
    try {
      await adminDeleteCompany(company.id)
      setCompanies((prev) => prev.filter((c) => c.id !== company.id))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete company')
    }
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'name' ? 'asc' : 'desc')
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronUp className="w-3 h-3 opacity-20" />
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-blue-600" />
      : <ChevronDown className="w-3 h-3 text-blue-600" />
  }

  const filtered = companies
    .filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let av: string | number, bv: string | number
      if (sortField === 'name') {
        av = a.name.toLowerCase()
        bv = b.name.toLowerCase()
      } else if (sortField === 'last_modified') {
        av = a.last_modified ?? ''
        bv = b.last_modified ?? ''
      } else {
        av = a[sortField]
        bv = b[sortField]
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })

  const SORT_OPTIONS: { field: SortField; label: string }[] = [
    { field: 'name', label: 'Name' },
    { field: 'markdown_word_count', label: 'Words' },
    { field: 'total_corrections', label: 'Corrections' },
    { field: 'last_modified', label: 'Last edited' },
  ]

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-[15px]" style={{ fontWeight: 600 }}>Companies</h2>
        <span className="text-[12px] text-muted-foreground">{companies.length} total</span>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-2 bg-white border border-border rounded-lg px-3 py-1.5 max-w-sm flex-1">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            className="bg-transparent outline-none text-[13px] flex-1"
            placeholder="Search companies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={startAdding}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] transition-colors"
          style={{ backgroundColor: '#030213', color: 'white', fontWeight: 500 }}
        >
          <Plus className="w-3.5 h-3.5" />
          Add Company
        </button>
      </div>

      <div className="flex items-center gap-1 mb-5">
        <span className="text-[11px] text-muted-foreground mr-1">Sort:</span>
        {SORT_OPTIONS.map(({ field, label }) => (
          <button
            key={field}
            onClick={() => handleSort(field)}
            className={`flex items-center gap-0.5 px-2 py-1 rounded text-[11px] transition-colors ${
              sortField === field
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-white border border-border text-muted-foreground hover:text-foreground'
            }`}
            style={{ fontWeight: sortField === field ? 600 : 400 }}
          >
            {label}
            <SortIcon field={field} />
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {adding && (
            <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Plus className="w-4 h-4 text-blue-400 shrink-0" />
              <input
                ref={addInputRef}
                className="flex-1 bg-transparent outline-none text-[13px]"
                placeholder="Company name..."
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                  if (e.key === 'Escape') cancelAdding()
                }}
                disabled={addSaving}
              />
              <button onClick={handleCreate} disabled={addSaving || !addText.trim()} className="p-1 rounded hover:bg-blue-100 disabled:opacity-50">
                {addSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-emerald-600" />}
              </button>
              <button onClick={cancelAdding} className="p-1 rounded hover:bg-blue-100">
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
          )}
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
                {c.last_modified && (
                  <span>{new Date(c.last_modified).toLocaleDateString()}</span>
                )}
                {c.pending_corrections > 0 && (
                  <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-[10px]" style={{ fontWeight: 500 }}>
                    {c.pending_corrections} pending
                  </span>
                )}
                <button
                  onClick={(e) => handleDelete(e, c)}
                  className="p-1 rounded hover:bg-red-50 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
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
