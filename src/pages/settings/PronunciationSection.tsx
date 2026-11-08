import { useState } from 'react'
import { Volume2, X } from 'lucide-react'
import { DriveError } from '../../components/DriveError'
import { inputClass } from '../../components/Sheet'
import { newId } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import { BUILT_IN, pronunciationError } from '../../lib/pronounce'
import { canSpeak, speak } from '../../lib/speech'
import { tx } from '../../i18n'

// Words the assistant's voice says wrong, and how to write them so it says them right. Every change
// is saved at once. The built-in words can be replaced by adding the same word, not deleted.

const ERRORS: Record<string, string> = {
  word: tx('כתוב את המילה כמו שהיא נכתבת.'),
  say: tx('כתוב איך לומר אותה. אפשר גם באותיות באנגלית.'),
  same: tx('כתוב את ההגייה אחרת מהמילה, אחרת שום דבר לא ישתנה.'),
}

export function PronunciationSection() {
  const list = useDriveList('pronunciations')
  const [word, setWord] = useState('')
  const [say, setSay] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)

  const write = async (next: typeof list.items) => {
    setSaveError(null)
    try {
      await list.save(next)
      return true
    } catch (e) {
      setSaveError(e)
      return false
    }
  }

  const add = async () => {
    const err = pronunciationError(word, say)
    setError(err && ERRORS[err])
    if (err) return
    const w = word.trim()
    const ok = await write([...list.items.filter((p) => p.word !== w), { id: newId(), word: w, say: say.trim() }])
    if (ok) {
      setWord('')
      setSay('')
    }
  }

  const builtIn = BUILT_IN.filter((b) => !list.items.some((p) => p.word === b.word))
  const listen = (text: string) => speak(text)

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        {tx('מילים ששלי מבטא לא נכון, ואיך לכתוב אותן כדי שיגיד אותן נכון. בטלפונים רבים ניקוד לא עוזר, אבל כתיבה אחרת כן, לפעמים רק באותיות באנגלית: "טפסן" נכתב Tapsan. המילה מתוקנת גם עם ה, ב, ל או ו לפניה.')}
      </p>
      {saveError != null && <DriveError error={saveError} action="save" />}

      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="font-semibold">{tx('מילה חדשה')}</h2>
        <label className="block space-y-1">
          <span className="text-sm text-slate-300">{tx('המילה, כמו שהיא נכתבת')}</span>
          <input id="pron-word" value={word} onChange={(e) => setWord(e.target.value)} placeholder={tx('למשל: טפסן')} className={inputClass} autoComplete="off" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-slate-300">{tx('איך לומר אותה')}</span>
          <input id="pron-say" value={say} onChange={(e) => setSay(e.target.value)} placeholder={tx('למשל: Tapsan')} className={inputClass} autoComplete="off" />
        </label>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex gap-2">
          {canSpeak && (
            <button type="button" onClick={() => listen(say)} disabled={!say.trim()} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-slate-200 disabled:opacity-40">
              <Volume2 size={18} aria-hidden />
              {tx('שמע')}
            </button>
          )}
          <button type="button" onClick={() => void add()} disabled={list.saving} className="min-h-11 flex-1 rounded-xl bg-sky-600 px-4 font-semibold text-white disabled:opacity-50">
            {tx('שמירה')}
          </button>
        </div>
      </section>

      <ul className="space-y-2">
        {list.items.map((p) => (
          <Row key={p.id} word={p.word} say={p.say} onListen={() => listen(p.word)} onRemove={() => void write(list.items.filter((x) => x.id !== p.id))} busy={list.saving} />
        ))}
        {builtIn.map((p) => (
          <Row key={p.word} word={p.word} say={p.say} onListen={() => listen(p.word)} />
        ))}
      </ul>
    </div>
  )
}

function Row({ word, say, onListen, onRemove, busy }: { word: string; say: string; onListen: () => void; onRemove?: () => void; busy?: boolean }) {
  return (
    <li className="flex min-h-14 items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2">
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{word}</span>
        <span className="text-slate-400">{' ← '}</span>
        <span dir="auto" className="text-slate-200">{say}</span>
        {!onRemove && <span className="ms-2 text-xs text-slate-500">{tx('מובנה')}</span>}
      </span>
      {canSpeak && (
        <button type="button" onClick={onListen} aria-label={tx('שמע איך שלי אומר את {v}', { v: word })} className="flex size-11 items-center justify-center rounded-xl text-slate-300">
          <Volume2 size={18} aria-hidden />
        </button>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} disabled={busy} aria-label={tx('מחיקת {v}', { v: word })} className="flex size-11 items-center justify-center rounded-xl text-slate-400 disabled:opacity-40">
          <X size={18} aria-hidden />
        </button>
      )}
    </li>
  )
}
