import { useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { inputClass } from './Sheet'

// Text field with Hebrew voice dictation (Web Speech API, he-IL). See docs/spikes/hebrew-dictation.md.
// The mic button shows only where the browser has speech recognition; the phone keyboard's own
// mic key works everywhere. Dictated words are added after what is already there, never replace it.

interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type RecognitionCtor = new () => Recognition

const Speech = (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition

const ERRORS: Record<string, string> = {
  'not-allowed': 'אין הרשאה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן, או להשתמש במיקרופון של המקלדת.',
  'service-not-allowed': 'אין הרשאה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן, או להשתמש במיקרופון של המקלדת.',
  network: 'ההכתבה צריכה אינטרנט. אפשר להקליד, או להשתמש במיקרופון של המקלדת.',
  'no-speech': 'לא נשמע דיבור. נסה שוב.',
}

export function DictationField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Recognition | null>(null)

  useEffect(() => () => rec.current?.stop(), [])

  const toggle = () => {
    if (!Speech) return
    if (rec.current) {
      rec.current.stop()
      return
    }
    const r = new Speech()
    r.lang = 'he-IL'
    r.interimResults = true
    r.continuous = true
    const base = value.trim() ? `${value.trim()} ` : ''
    r.onresult = (e) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
      onChange(base + text.trim())
    }
    r.onerror = (e) => e.error !== 'aborted' && setError(ERRORS[e.error] ?? 'ההכתבה לא הצליחה. אפשר להקליד במקום.')
    r.onend = () => {
      rec.current = null
      setListening(false)
    }
    setError(null)
    rec.current = r
    setListening(true)
    r.start()
  }

  return (
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="text-sm text-slate-300">{label}</span>
        <textarea rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      </label>
      {Speech && (
        <button
          type="button"
          onClick={toggle}
          aria-pressed={listening}
          className={`flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm ${
            listening ? 'border-red-500 bg-red-500/15 text-red-200' : 'border-slate-700 text-slate-200'
          }`}
        >
          {listening ? <Square size={16} aria-hidden /> : <Mic size={18} aria-hidden />}
          {listening ? 'מקשיב... לחץ לעצירה' : 'הכתבה בקול'}
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}
        </p>
      )}
    </div>
  )
}
