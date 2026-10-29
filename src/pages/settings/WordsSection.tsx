import { useState } from 'react'
import { X } from 'lucide-react'
import { DriveError } from '../../components/DriveError'
import { inputClass } from '../../components/Sheet'
import { upsert } from '../../lib/catalog'
import { addWord, BUILT_IN, groupWords, GROUPS, removeWord, wordError } from '../../lib/constraintWords'
import { useDriveList } from '../../lib/data/useDriveList'
import type { WordGroup, WordGroupSetting } from '../../types/models'

// The words a worker's WhatsApp answer is read by, one card per group. Every change is saved at once.

export function WordsSection() {
  const words = useDriveList('constraintWords')
  const [saveError, setSaveError] = useState<unknown>(null)

  const write = async (next: WordGroupSetting[]) => {
    setSaveError(null)
    try {
      await words.save(next)
    } catch (e) {
      setSaveError(e)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        לפי המילים האלה האפליקציה מבינה תשובת אילוצים מוואטסאפ: האם העובד לא זמין בבוקר, בצהריים, בערב או כל היום. מספיק תחילת מילה: "חתונ" מתאים גם ל"חתונה" וגם ל"בחתונות".
      </p>
      {saveError != null && <DriveError error={saveError} action="save" />}
      {GROUPS.map((g) => (
        <WordGroupCard
          key={g.id}
          id={g.id}
          title={g.title}
          explain={g.explain}
          setting={words.items.find((s) => s.id === g.id)}
          busy={words.saving}
          onChange={(s) => write(upsert(words.items, s))}
          onReset={() => write(words.items.filter((s) => s.id !== g.id))}
        />
      ))}
    </div>
  )
}

function WordGroupCard({
  id,
  title,
  explain,
  setting,
  busy,
  onChange,
  onReset,
}: {
  id: WordGroup
  title: string
  explain: string
  setting?: WordGroupSetting
  busy: boolean
  onChange: (s: WordGroupSetting) => void
  onReset: () => void
}) {
  const [word, setWord] = useState('')
  const [error, setError] = useState<string | null>(null)
  const list = groupWords(id, setting)
  const changed = !!setting && (setting.added.length > 0 || setting.removed.length > 0)

  const add = () => {
    const err = wordError(word, list)
    setError(err)
    if (err) return
    onChange(addWord(id, setting, word))
    setWord('')
  }

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-xs text-slate-400">{explain}</p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {list.map((w) => (
          <li key={w}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onChange(removeWord(id, setting, w))}
              aria-label={`הסרת המילה ${w.trim()}`}
              className={`flex min-h-9 items-center gap-1 rounded-full border px-3 text-sm disabled:opacity-50 ${
                BUILT_IN[id].includes(w) ? 'border-slate-700 text-slate-200' : 'border-sky-500/60 text-sky-200'
              }`}
            >
              {w.trim()}
              <X size={14} aria-hidden className="text-slate-400" />
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="text-sm text-amber-300">אין מילים בקבוצה הזו.</li>}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="מילה חדשה" aria-label={`מילה חדשה ל${title}`} className={inputClass} />
        <button type="submit" disabled={busy} className="min-h-12 shrink-0 rounded-xl bg-sky-500 px-4 font-semibold text-slate-950 disabled:opacity-50">
          הוספה
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}
        </p>
      )}
      {changed && (
        <button type="button" disabled={busy} onClick={onReset} className="text-sm text-slate-400 underline disabled:opacity-50">
          החזרת המילים המקוריות
        </button>
      )}
    </section>
  )
}
