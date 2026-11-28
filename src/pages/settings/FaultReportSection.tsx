import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, MessageCircle, Send, Square, Volume2 } from 'lucide-react'
import { ChoiceList } from '../../components/ChoiceList'
import { DictationField } from '../../components/DictationField'
import { inputClass } from '../../components/Sheet'
import { detectDevice } from '../../lib/deviceInfo'
import { canSpeak, speak, stopSpeaking } from '../../lib/speech'
import { language, tx } from '../../i18n'

// A manager reports something broken (2026-11-23, an SLA item: one fixed way to report a fault).
// The server emails it to a dedicated address kept only in Vercel (FAULT_REPORT_EMAIL); the
// browser never learns it. The device, system, version and time are filled in by the app and
// the manager can correct them (the owner, 2026-11-24); language and app version are added unseen.
// An urgent fault can also go by WhatsApp (the owner's choice): a wa.me link to FAULT_WHATSAPP,
// which the server hands only to signed-in managers. WhatsApp shows that number, by nature.

const MAX = 4000

// The value is the Hebrew name, so the mail reads the same whatever language the manager uses.
const places = () => [
  { value: 'יומן', label: tx('יומן') },
  { value: 'עובדים', label: tx('עובדים') },
  { value: 'Shali', label: tx('Shali (העוזר הקולי)') },
  { value: 'יומן אישי', label: tx('יומן אישי') },
  { value: 'הגדרות', label: tx('הגדרות') },
  { value: 'כניסה לאפליקציה', label: tx('כניסה לאפליקציה') },
  { value: 'אחר', label: tx('אחר') },
]
const whereLabel = (v: string) => places().find((w) => w.value === v)?.label ?? v

const REASONS: Record<string, string> = {
  'not-configured': tx('השליחה עוד לא הוגדרה בשרת.'),
  'no-key': tx('השליחה במייל עוד לא הוגדרה בשרת.'),
  'too-many': tx('נשלחו הרבה בקשות בזמן קצר. נסה שוב בעוד שעה.'),
  'bad-body': tx('התיאור ריק או ארוך מדי.'),
  'send-failed': tx('המייל לא נשלח. נסה שוב בעוד כמה דקות.'),
  'no-session': tx('צריך להתחבר מחדש.'),
  'mfa-required': tx('צריך להזין את הקוד הדו-שלבי מחדש.'),
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Now, as a datetime-local value: 2026-11-24T03:40 (the phone's own clock and zone). */
const nowLocal = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
/** 2026-11-24T03:40 -> 24.11.2026 03:40, for the mail. */
const showWhen = (v: string) => {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}` : v
}

interface Device {
  model: string
  os: string
  osVersion: string
}

function details(urgent: boolean, where: string, device: Device, occurredAt: string) {
  return {
    urgent,
    where,
    ...device,
    occurredAt: showWhen(occurredAt),
    page: location.origin + location.pathname,
    device: `${navigator.userAgent} · ${screen.width}x${screen.height}${navigator.onLine ? '' : ' · offline'}`,
    language: language().code,
    release: (import.meta.env.VITE_RELEASE as string | undefined)?.slice(0, 12) ?? '',
  }
}

export function FaultReportSection() {
  const [text, setText] = useState('')
  const [where, setWhere] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [reading, setReading] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [whatsapp, setWhatsapp] = useState('')
  const [device, setDevice] = useState<Device>({ model: '', os: '', osVersion: '' })
  const [occurredAt, setOccurredAt] = useState(() => nowLocal())
  // Leaving stops only this page's own reading, never Shali talking meanwhile (owner, 2026-11-28).
  const readingRef = useRef(false)
  readingRef.current = reading
  useEffect(() => () => void (readingRef.current && stopSpeaking()), [])
  useEffect(() => {
    let live = true
    // Fills only what the manager has not typed yet.
    void detectDevice().then((d) => live && setDevice((cur) => ({ model: cur.model || d.model, os: cur.os || d.os, osVersion: cur.osVersion || d.osVersion })))
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    let live = true
    fetch('/api/feedback', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { whatsapp?: string }) => live && setWhatsapp(/^\d{9,15}$/.test(d.whatsapp ?? '') ? d.whatsapp! : ''))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const readAloud = () => {
    if (reading) {
      stopSpeaking()
      setReading(false)
      return
    }
    setReading(true)
    speak(text.trim(), () => setReading(false))
  }

  const send = async () => {
    setError(null)
    setState('sending')
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'fault', text: text.trim(), details: details(urgent, where, device, occurredAt) }),
      })
      if (res.ok) {
        setState('sent')
        setText('')
        setWhere('')
        setUrgent(false)
        setOccurredAt(nowLocal())
        return
      }
      const data = (await res.json().catch(() => ({}))) as { reason?: string }
      setError(REASONS[data.reason ?? ''] ?? (res.status === 404 ? REASONS['not-configured'] : tx('השליחה לא הצליחה. נסה שוב.')))
    } catch {
      setError(tx('אין חיבור לאינטרנט.'))
    }
    setState('idle')
  }

  const empty = !text.trim()
  const tooLong = text.length > MAX
  const choice = (on: boolean) =>
    `flex min-h-11 flex-1 items-center justify-center rounded-xl border px-3 text-sm ${on ? 'border-sky-400 bg-sky-500/10 text-sky-200' : 'border-slate-700 text-slate-200'}`
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">{tx('דיווח על תקלה')}</h1>
      <p className="text-sm text-slate-400">{tx('משהו לא עובד? תאר מה ניסית לעשות ומה קרה. הדיווח נשלח במייל לצוות התמיכה, עם פרטי המכשיר והגרסה.')}</p>
      {state === 'sent' && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-700 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          <CheckCircle2 size={18} aria-hidden className="shrink-0" />
          {tx('הדיווח נשלח. נחזור אליך במייל.')}
        </p>
      )}
      <fieldset className="space-y-1">
        <legend className="text-sm text-slate-300">{tx('כמה זה דחוף?')}</legend>
        <div className="flex gap-2">
          <button type="button" aria-pressed={!urgent} onClick={() => setUrgent(false)} className={choice(!urgent)}>
            {tx('רגיל: משהו לא עובד כמו שצריך')}
          </button>
          <button type="button" aria-pressed={urgent} onClick={() => setUrgent(true)} className={choice(urgent)}>
            {tx('דחוף: אי אפשר לעבוד')}
          </button>
        </div>
      </fieldset>
      <ChoiceList
        label={tx('איפה באפליקציה?')}
        value={where}
        placeholder={tx('בחר מסך (לא חובה)')}
        options={places()}
        onChange={setWhere}
      />
      <label className="block space-y-1">
        <span className="text-sm text-slate-300">{tx('מתי זה קרה?')}</span>
        <input type="datetime-local" value={occurredAt} max={nowLocal()} onChange={(e) => setOccurredAt(e.target.value)} className={inputClass} />
      </label>
      <DictationField
        label={tx('מה קרה?')}
        value={text}
        onChange={(v) => {
          setText(v)
          if (state === 'sent') setState('idle')
        }}
        placeholder={tx('למשל: לחצתי על שבץ ביומן ושום דבר לא קרה')}
      />
      {tooLong && <p className="text-sm text-amber-300">{tx('התיאור ארוך מדי ({length} מתוך {MAX} תווים).', { length: text.length, MAX })}</p>}
      <fieldset className="space-y-2">
        <legend className="text-sm text-slate-300">{tx('פרטי המכשיר (מולאו אוטומטית, אפשר לתקן)')}</legend>
        <label className="block space-y-1">
          <span className="text-xs text-slate-400">{tx('מכשיר')}</span>
          <input value={device.model} maxLength={80} placeholder={tx('למשל: Galaxy S23')} onChange={(e) => setDevice({ ...device, model: e.target.value })} className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-xs text-slate-400">{tx('מערכת הפעלה')}</span>
            <input value={device.os} maxLength={40} placeholder="Android" onChange={(e) => setDevice({ ...device, os: e.target.value })} className={inputClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-slate-400">{tx('גרסה')}</span>
            <input value={device.osVersion} maxLength={40} inputMode="decimal" placeholder="14" onChange={(e) => setDevice({ ...device, osVersion: e.target.value })} className={inputClass} />
          </label>
        </div>
      </fieldset>
      {canSpeak && (
        <button
          type="button"
          onClick={readAloud}
          disabled={empty}
          aria-pressed={reading}
          className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200 disabled:opacity-50"
        >
          {reading ? <Square size={16} aria-hidden /> : <Volume2 size={18} aria-hidden />}
          {reading ? tx('עצור הקראה') : tx('הקרא לי את הדיווח')}
        </button>
      )}
      <button
        type="button"
        onClick={send}
        disabled={empty || tooLong || state === 'sending'}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 py-3 font-semibold text-slate-950 disabled:opacity-50"
      >
        {state === 'sending' ? <Loader2 size={18} aria-hidden className="animate-spin" /> : <Send size={18} aria-hidden />}
        {state === 'sending' ? tx('שולח...') : tx('שליחת הדיווח')}
      </button>
      {urgent && whatsapp && (
        <a
          href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`${tx('תקלה דחופה ב-Shali')}${where ? ` (${whereLabel(where)})` : ''}: ${text.trim()}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-600 text-emerald-200"
        >
          <MessageCircle size={18} aria-hidden />
          {tx('שליחה גם בוואטסאפ')}
        </a>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}
        </p>
      )}
    </div>
  )
}
