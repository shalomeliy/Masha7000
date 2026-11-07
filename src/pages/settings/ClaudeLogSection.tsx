import { useEffect, useState } from 'react'
import { CheckCircle2, Copy, Loader2, Trash2 } from 'lucide-react'
import { clearLog, loadLog, logText, type ClaudeLogEntry, type LogOutcome } from '../../lib/claudeLog'
import { tx } from '../../i18n'

// Settings > "מה הלך ל-Claude": every voice request that was not done free, why, and what Claude did.
// The owner copies it into a development conversation, which teaches the next free action from it
// (skill free-commands). The text copied is in English: it is read by the developer, not shown here.

const OUTCOME: Record<LogOutcome, string> = {
  pending: tx('בלי תשובה'),
  answered: tx('Claude ענה'),
  confirmed: tx('אושר ונשמר'),
  cancelled: tx('בוטל'),
  failed: tx('לא הצליח'),
}

export function ClaudeLogSection() {
  const [entries, setEntries] = useState<ClaudeLogEntry[] | null>(null)
  const [fromServer, setFromServer] = useState(true)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    let live = true
    loadLog().then((r) => {
      if (!live) return
      setEntries(r.entries)
      setFromServer(r.fromServer)
    })
    return () => {
      live = false
    }
  }, [])

  const copy = async () => {
    setError(null)
    const text = logText(entries ?? [])
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      return
    } catch {
      // some browsers refuse the clipboard API: the old way below
    }
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    if (ok) setCopied(true)
    else setError(tx('ההעתקה לא הצליחה. נסה שוב.'))
  }

  const clear = async () => {
    setAsking(false)
    setError(null)
    const ok = await clearLog()
    if (!ok) setError(tx('היומן נמחק במכשיר הזה, אבל לא בשרת. נסה שוב.'))
    setEntries([])
    setCopied(false)
  }

  const list = entries ?? []
  const confirmed = list.filter((e) => e.outcome === 'confirmed')
  const learned = confirmed.filter((e) => e.learned).length
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">{tx('מה הלך ל-Claude')}</h1>
      <p className="text-sm text-slate-400">
        {tx('כאן נשמרת כל בקשה לעוזר הקולי שהאפליקציה לא ידעה לעשות לבד, בחינם: מה אמרת, למה היא עברה ל-Claude, מה Claude עשה, ואם אישרת. מעתיקים את היומן ומדביקים בשיחת פיתוח, וכך מלמדים את האפליקציה לעשות עוד סוגי בקשות בחינם.')}
      </p>
      <p className="text-sm text-slate-400">
        {tx('בקשה שחוזרת באותה צורה, עם שמות, ימים ומקומות אחרים, אפשר ללמד. בקשה חדשה לגמרי או לא ברורה תמיד תצטרך את Claude.')}
      </p>
      {entries === null ? (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={16} aria-hidden className="animate-spin" />
          {tx('טוען...')}
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-200">
            {list.length ? tx('{n} בקשות ביומן, {c} אושרו, מתוכן {l} כבר נלמדו.', { n: list.length, c: confirmed.length, l: learned }) : tx('היומן ריק. עוד לא הלכה ל-Claude אף בקשה.')}
          </p>
          {!fromServer && <p className="text-sm text-amber-300">{tx('השרת לא זמין, אז מוצגות רק הבקשות מהמכשיר הזה.')}</p>}
          {list.length > 0 && (
            <ul className="space-y-2">
              {list
                .slice(-5)
                .reverse()
                .map((e) => (
                  <li key={e.id} className="rounded-xl border border-slate-800 p-3 text-sm">
                    <p className="text-slate-100">{e.said.join(' / ')}</p>
                    <p className="text-xs text-slate-400">{OUTCOME[e.outcome] ?? e.outcome}</p>
                  </li>
                ))}
            </ul>
          )}
          {copied && (
            <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-700 bg-emerald-500/10 p-3 text-sm text-emerald-200">
              <CheckCircle2 size={18} aria-hidden className="shrink-0" />
              {tx('היומן הועתק. אפשר להדביק אותו בשיחת הפיתוח.')}
            </p>
          )}
          <button
            type="button"
            onClick={copy}
            disabled={!list.length}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 py-3 font-semibold text-slate-950 disabled:opacity-50"
          >
            <Copy size={18} aria-hidden />
            {tx('העתקת היומן')}
          </button>
          {list.length > 0 &&
            (asking ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>{tx('למחוק את כל היומן?')}</span>
                <button type="button" onClick={clear} className="min-h-11 rounded-xl bg-rose-600 px-4 font-semibold text-white">
                  {tx('כן, למחוק')}
                </button>
                <button type="button" onClick={() => setAsking(false)} className="min-h-11 rounded-xl border border-slate-700 px-4">
                  {tx('לא')}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setAsking(true)} className="flex min-h-11 items-center gap-2 text-sm text-slate-400">
                <Trash2 size={16} aria-hidden />
                {tx('ניקוי היומן')}
              </button>
            ))}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}
        </p>
      )}
    </div>
  )
}
