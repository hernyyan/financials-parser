/**
 * MappingFileTab — Admin viewer for a company's L2 formula mapping config.
 *
 * The mapping file is the JSON stored in layer2_formula_configs. It records
 * exactly which L1 rows (by row number and label) map to each L2 template
 * field, and with what arithmetic. This replaces the old AI-written company
 * context files with deterministic, analyst-configured instructions.
 */
import { useEffect, useState } from 'react'
import { Loader2, FileCode } from 'lucide-react'
import { API_BASE } from '../../api/client'

interface Props {
  companyId: number
}

export default function MappingFileTab({ companyId }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<{ formulas: Record<string, unknown> | null; updated_at: string | null } | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`${API_BASE}/companies/${companyId}/mapping-file`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [companyId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-[13px]">Loading mapping file…</span>
      </div>
    )
  }

  if (!data?.formulas) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground p-6">
        <FileCode className="w-10 h-10 opacity-30" />
        <p className="text-[13px]">No mapping file saved yet.</p>
        <p className="text-[11px] opacity-70 text-center max-w-xs">
          The mapping file is written when the analyst finalizes a Layer 2 review for this company.
          It records which L1 rows feed into each L2 template field.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border bg-gray-50">
        <p className="text-[12px] text-slate-600" style={{ fontWeight: 500 }}>Mapping File</p>
        {data.updated_at && (
          <p className="text-[11px] text-muted-foreground">
            Last updated:{' '}
            {new Date(data.updated_at).toLocaleString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </p>
        )}
      </div>

      {/* Raw JSON */}
      <div className="flex-1 overflow-auto bg-slate-950 p-4 font-mono text-[11px] leading-relaxed">
        <pre className="text-green-300 whitespace-pre-wrap break-all">
          {JSON.stringify(data.formulas, null, 2)}
        </pre>
      </div>
    </div>
  )
}
