import { useState } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { adminUpdateCompanyContext } from './AdminApiClient'

interface Props {
  companyId: number
  content: string
  onSaved: (newContent: string) => void
}

export default function CompanyContextEditor({ companyId, content, onSaved }: Props) {
  const [text, setText] = useState(content)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setSavedMsg(null)
    try {
      const res = await adminUpdateCompanyContext(companyId, text)
      onSaved(text)
      setSavedMsg(`Saved — ${res.word_count} words`)
      setTimeout(() => setSavedMsg(null), 3000)
    } catch (err) {
      setSavedMsg(`Error: ${err instanceof Error ? err.message : 'Save failed'}`)
    } finally {
      setSaving(false)
    }
  }

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-gray-50 shrink-0">
        <span className="text-[11px]" style={{ fontWeight: 500 }}>Context File</span>
        <div className="flex items-center gap-2">
          {savedMsg && (
            <span className={`text-[11px] ${savedMsg.startsWith('Error') ? 'text-red-500' : 'text-emerald-600'}`}>
              {savedMsg}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] disabled:opacity-50 transition-colors"
            style={{ backgroundColor: '#030213', color: 'white', fontWeight: 500 }}
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save
          </button>
        </div>
      </div>
      <textarea
        className="flex-1 w-full p-3 text-[12px] font-mono resize-none outline-none border-0 bg-white"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <div className="px-3 py-1.5 border-t border-border bg-gray-50 shrink-0">
        <span className="text-[11px] text-muted-foreground">{wordCount} words</span>
      </div>
    </div>
  )
}
