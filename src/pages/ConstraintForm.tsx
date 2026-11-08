import { tx } from '../i18n'
import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Field, inputClass } from '../components/Sheet'
import { isIsraeliMobile } from '../lib/catalog'
import { dayAnswer, readConstraintForm, savedPhone, savePhone, submitConstraints, type DayChoice, type DayPart } from '../lib/constraintForm'
import { addDays, DAY_NAMES, showDate } from '../lib/shifts'

// The page a worker opens from the WhatsApp link: the days of one week they cannot work. No sign-in;
// the mobile number tells the manager who it is. Nothing else of the app is reachable here.

const PARTS: { id: DayPart; name: string }[] = [
  { id: 'whole', name: tx('כל היום') },
  { id: 'morning', name: tx('בוקר') },
  { id: 'noon', name: tx('צהריים') },
  { id: 'evening', name: tx('ערב') },
  { id: 'night', name: tx('בלי לילה') },
]

const blankDays = (): DayChoice[] => Array.from({ length: 7 }, () => ({ text: '', weekly: false }))

export function ConstraintForm({ code }: { code: string }) {
  const [weekStart, setWeekStart] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [phone, setPhone] = useState(savedPhone)
  const [days, setDays] = useState<DayChoice[]>(blankDays)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  useEffect(() => {
    document.title = tx('אילוצים לשבוע')
    readConstraintForm(code).then(
      (r) => setWeekStart(r.weekStart),
      (e: Error) => setLoadError(e.message),
    )
  }, [code])

  const setDay = (i: number, patch: Partial<DayChoice>) => setDays((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)))

  const send = async () => {
    if (!isIsraeliMobile(phone)) {
      setError(tx('הטלפון הנייד לא תקין. צריך 10 ספרות שמתחילות ב-05, למשל 050-1234567'))
      return
    }
    setError(null)
    setBusy(true)
    try {
      const r = await submitConstraints(code, phone, days.map(dayAnswer), notes)
      savePhone(phone)
      setSentTo(r.firstName)
      window.scrollTo(0, 0)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (sentTo !== null)
    return (
      <main className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <CheckCircle2 size={48} className="text-emerald-400" aria-hidden />
        <h1 className="text-2xl font-bold">{tx('תודה, {trim}!', { trim: sentTo })}</h1>
        <p className="text-slate-300">{tx('האילוצים שלך נשלחו למנהל. אפשר לסגור את הדף.')}</p>
        <button type="button" onClick={() => setSentTo(null)} className="min-h-11 rounded-xl border border-slate-700 px-4 text-sm text-slate-300">
          {tx('טעיתי, לתקן ולשלוח שוב')}
        </button>
      </main>
    )

  if (loadError)
    return (
      <main className="mx-auto flex min-h-full max-w-md items-center justify-center px-6 text-center">
        <p role="alert" className="text-slate-300">{loadError}</p>
      </main>
    )

  if (!weekStart)
    return (
      <main className="flex min-h-full items-center justify-center gap-2 text-slate-400">
        <Loader2 className="animate-spin" size={20} aria-hidden />
        {tx('טוען את הטופס...')}
      </main>
    )

  return (
    <main className="mx-auto max-w-md space-y-5 px-4 pb-16 pt-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{tx('אילוצים לשבוע {v} עד {v2}', { v: showDate(weekStart), v2: showDate(addDays(weekStart, 6)) })}</h1>
        <p className="text-sm text-slate-400">{tx('מסמנים רק את הימים שבהם אין לך אפשרות לעבוד. יום שלא סימנת, המנהל יודע שאפשר לשבץ אותך בו.')}</p>
      </header>

      <Field label={tx('הטלפון הנייד שלך (חובה)')} hint={tx('אותו מספר שיש למנהל. לפיו הוא יודע שזה אתה.')}>
        <input type="tel" dir="ltr" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${inputClass} text-right`} />
      </Field>

      <ul className="space-y-3">
        {days.map((d, i) => {
          const date = addDays(weekStart, i)
          const filled = !!dayAnswer(d)
          return (
            <li key={date} className={`space-y-2 rounded-2xl border p-3 ${filled ? 'border-amber-500/50 bg-amber-500/5' : 'border-slate-800 bg-slate-900'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-semibold">{`${DAY_NAMES[i]} ${showDate(date)}`}</h2>
                <span className={`text-xs ${filled ? 'text-amber-300' : 'text-emerald-400'}`}>{filled ? tx('לא יכול') : tx('יכול לעבוד')}</span>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={tx('מתי אין לך אפשרות ב{v}', { v: DAY_NAMES[i] })}>
                {PARTS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={d.part === p.id}
                    onClick={() => setDay(i, { part: d.part === p.id ? undefined : p.id })}
                    className={`min-h-10 rounded-full border px-3 text-sm ${d.part === p.id ? 'border-amber-400 bg-amber-400/15 text-amber-200' : 'border-slate-700 text-slate-300'}`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <input
                value={d.text}
                onChange={(e) => setDay(i, { text: e.target.value })}
                maxLength={100}
                placeholder={tx('סיבה, לא חובה (חופש, לימודים, אירוע...)')}
                aria-label={tx('סיבה ל{v}', { v: DAY_NAMES[i] })}
                className={`${inputClass} py-2 text-sm`}
              />
              {filled && (
                <label className="flex min-h-10 items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={d.weekly} onChange={(e) => setDay(i, { weekly: e.target.checked })} className="size-5 shrink-0 accent-amber-400" />
                  {tx('ככה כל שבוע (קבוע)')}
                </label>
              )}
            </li>
          )
        })}
      </ul>

      <Field label={tx('הערות למנהל')}>
        <textarea rows={3} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
      </Field>

      <p className="text-xs text-slate-400">
        {tx('מה שנשלח מגיע רק למנהל העבודה שלך, כדי לא לשבץ אותך בימים שאין לך אפשרות.')}{' '}
        <a href="/privacy.html" target="_blank" rel="noopener" className="text-sky-300 underline">
          {tx('מדיניות הפרטיות')}
        </a>
      </p>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <button type="button" onClick={send} disabled={busy} className="min-h-12 w-full rounded-xl bg-sky-500 font-semibold text-slate-950 disabled:opacity-50">
        {busy ? tx('שולח...') : tx('שליחה למנהל')}
      </button>
    </main>
  )
}
