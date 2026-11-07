import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Send, Square, Volume2 } from 'lucide-react'
import { DictationField } from '../../components/DictationField'
import { canSpeak, speak, stopSpeaking } from '../../lib/speech'

// A manager writes or dictates an idea for the app; it can be read back aloud before sending, and
// the server emails it to the app's maker (api/feedback.ts). The address never reaches the browser.

const MAX = 4000

const REASONS: Record<string, string> = {
  'not-configured': 'השליחה עוד לא הוגדרה בשרת.',
  'no-key': 'השליחה במייל עוד לא הוגדרה בשרת.',
  'too-many': 'נשלחו הרבה בקשות בזמן קצר. נסה שוב בעוד שעה.',
  'bad-body': 'הבקשה ריקה או ארוכה מדי.',
  'send-failed': 'המייל לא נשלח. נסה שוב בעוד כמה דקות.',
  'no-session': 'צריך להתחבר מחדש.',
  'mfa-required': 'צריך להזין את הקוד הדו-שלבי מחדש.',
}

export function FeatureRequestSection() {
  const [text, setText] = useState('')
  const [reading, setReading] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => () => void stopSpeaking(), [])

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
        body: JSON.stringify({ text: text.trim() }),
      })
      if (res.ok) {
        setState('sent')
        setText('')
        return
      }
      const data = (await res.json().catch(() => ({}))) as { reason?: string }
      setError(REASONS[data.reason ?? ''] ?? (res.status === 404 ? REASONS['not-configured'] : 'השליחה לא הצליחה. נסה שוב.'))
    } catch {
      setError('אין חיבור לאינטרנט.')
    }
    setState('idle')
  }

  const empty = !text.trim()
  const tooLong = text.length > MAX
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">בקשת תכונות חדשות</h1>
      <p className="text-sm text-slate-400">כתוב או הכתב מה היית רוצה שהאפליקציה תדע לעשות. הבקשה נשלחת במייל למפתח.</p>
      {state === 'sent' && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-700 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          <CheckCircle2 size={18} aria-hidden className="shrink-0" />
          הבקשה נשלחה. תודה!
        </p>
      )}
      <DictationField
        label="הבקשה שלך"
        value={text}
        onChange={(v) => {
          setText(v)
          if (state === 'sent') setState('idle')
        }}
        placeholder="למשל: שאפשר לשלוח לעובד תזכורת יום לפני העבודה"
      />
      {tooLong && <p className="text-sm text-amber-300">הבקשה ארוכה מדי ({text.length} מתוך {MAX} תווים).</p>}
      <div className="flex flex-wrap gap-2">
        {canSpeak && (
          <button
            type="button"
            onClick={readAloud}
            disabled={empty}
            aria-pressed={reading}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200 disabled:opacity-50"
          >
            {reading ? <Square size={16} aria-hidden /> : <Volume2 size={18} aria-hidden />}
            {reading ? 'עצור הקראה' : 'הקרא לי את הבקשה'}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={send}
        disabled={empty || tooLong || state === 'sending'}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 py-3 font-semibold text-slate-950 disabled:opacity-50"
      >
        {state === 'sending' ? <Loader2 size={18} aria-hidden className="animate-spin" /> : <Send size={18} aria-hidden />}
        {state === 'sending' ? 'שולח...' : 'שליחה'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}
        </p>
      )}
    </div>
  )
}
