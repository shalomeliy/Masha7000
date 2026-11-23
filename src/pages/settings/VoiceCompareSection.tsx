import { useEffect, useRef, useState } from 'react'
import { Copy, Loader2, Play, Star } from 'lucide-react'
import { tx } from '../../i18n'

// Spike (the owner, 2026-11-23): which Hebrew voice sounds right for Shali? Real Shali sentences, each in
// four versions: Chirp 3 HD as today, with niqqud added by Dicta's Nakdan, Gemini TTS, Gemini with niqqud
// (server: api/_lib/voiceCompare.ts). Each version is fetched once and replayed from memory. The owner
// marks the best per sentence and copies the results. Throwaway: goes once a voice is picked.

// Hebrew only on purpose: this tests the Hebrew voice. Traps: names, טפסן, plate digits, a date, stress.
const SENTENCES = [
  'רגע, בודק.',
  'יוסי כהן חולה מחר, אז העברתי את משה לוי לעבודה בחיפה.',
  'יש שתי עבודות לילה השבוע, ושני טפסנים עדיין חסרים.',
  'רכב 345, איסוזו דימקס, משובץ ליום שלישי בשמונה בבוקר.',
  'ההסמכה של דני לעבודה בגובה פגה בעוד עשרים ושלושה ימים.',
  'לשבץ את אבי לעבודה בתל אביב ביום ראשון? אשר או תקן.',
]

const VERSIONS = [
  { id: 'chirp', engine: 'chirp', nikud: false },
  { id: 'chirp+n', engine: 'chirp', nikud: true },
  { id: 'gemini', engine: 'gemini', nikud: false },
  { id: 'gemini+n', engine: 'gemini', nikud: true },
] as const
type VersionId = (typeof VERSIONS)[number]['id']
const label = (v: (typeof VERSIONS)[number]) => {
  const name = v.engine === 'chirp' ? 'Chirp' : 'Gemini'
  return v.nikud ? tx('{name} + ניקוד', { name }) : name
}

const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

type Got = { url: string; engine: string; said: string; msNikud: number; msVoice: number; msTotal: number } | { error: string }

export function VoiceCompareSection() {
  const [own, setOwn] = useState('')
  const [got, setGot] = useState<Record<string, Got>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [best, setBest] = useState<Record<string, VersionId>>({})
  const [copied, setCopied] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const urls = useRef<string[]>([])
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  const sentences = own.trim() ? [...SENTENCES, own.trim()] : SENTENCES

  // An iPhone plays only from an element that first played during a tap (as in cloudVoice.ts): one
  // element, woken with silence on the tap, then given the clip when it arrives.
  const wake = () => {
    audio.current ??= new Audio()
    audio.current.src = SILENCE
    void audio.current.play().catch(() => undefined)
  }
  const play = (url: string) => {
    const a = (audio.current ??= new Audio())
    a.pause()
    a.src = url
    void a.play().catch(() => undefined)
  }

  const run = async (text: string, v: (typeof VERSIONS)[number]) => {
    const key = `${v.id}|${text}`
    const have = got[key]
    if (have && 'url' in have) return play(have.url)
    wake()
    setBusy(key)
    const started = performance.now()
    try {
      const res = await fetch('/api/assistant?voicecompare', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, engine: v.engine, nikud: v.nikud }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) throw new Error(`${res.status} ${String(data.reason ?? '')} ${String(data.detail ?? '')}`.trim())
      const bytes = Uint8Array.from(atob(String(data.audio)), (c) => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: String(data.mime) }))
      urls.current.push(url)
      const g: Got = {
        url,
        engine: String(data.engine),
        said: String(data.said),
        msNikud: Number(data.msNikud),
        msVoice: Number(data.msVoice),
        msTotal: Math.round(performance.now() - started),
      }
      setGot((m) => ({ ...m, [key]: g }))
      play(url)
    } catch (e) {
      setGot((m) => ({ ...m, [key]: { error: (e as Error).message } }))
    }
    setBusy(null)
  }

  const report = () =>
    sentences
      .map((s) => {
        const rows = VERSIONS.map((v) => {
          const g = got[`${v.id}|${s}`]
          const mark = best[s] === v.id ? ' *BEST*' : ''
          if (!g) return `  ${v.id}: -${mark}`
          if ('error' in g) return `  ${v.id}: error ${g.error}${mark}`
          return `  ${v.id}: ${g.engine} nikud ${g.msNikud} ms, voice ${g.msVoice} ms, total ${g.msTotal} ms${mark}`
        })
        return [s, ...rows].join('\n')
      })
      .join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report())
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{tx('השוואת קולות')}</h2>
        <p className="text-sm text-slate-300">
          {tx('כל לחיצה שולחת את המשפט לגוגל (ולניקוד של דיקטה) ועולה סנטים בודדים. לחיצה שנייה משמיעה שוב בלי לשלוח.')}
        </p>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="text-slate-300">{tx('משפט משלך')}</span>
        <input
          value={own}
          onChange={(e) => setOwn(e.target.value.slice(0, 300))}
          className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-base text-slate-100"
        />
      </label>
      <ul className="space-y-3">
        {sentences.map((s) => (
          <li key={s} className="space-y-2 rounded-xl border border-slate-700 p-3">
            <p className="text-base text-slate-100">{s}</p>
            <div className="grid grid-cols-2 gap-2">
              {VERSIONS.map((v) => {
                const key = `${v.id}|${s}`
                const g = got[key]
                return (
                  <div key={v.id} className="space-y-1">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void run(s, v)}
                        disabled={busy !== null && busy !== key}
                        className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-sky-600 px-2 text-sm text-sky-200"
                      >
                        {busy === key ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Play size={16} aria-hidden />}
                        <span dir="auto">{label(v)}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={tx('הכי טוב')}
                        aria-pressed={best[s] === v.id}
                        onClick={() => setBest((b) => ({ ...b, [s]: v.id }))}
                        className={`flex min-h-11 min-w-11 items-center justify-center rounded-xl border ${
                          best[s] === v.id ? 'border-amber-400 bg-amber-400/20 text-amber-300' : 'border-slate-700 text-slate-400'
                        }`}
                      >
                        <Star size={16} aria-hidden />
                      </button>
                    </div>
                    {g && 'url' in g && (
                      <p dir="ltr" className="text-xs text-slate-400">
                        {g.msTotal} ms{g.msNikud ? ` (nikud ${g.msNikud})` : ''}
                      </p>
                    )}
                    {g && 'error' in g && (
                      <p role="status" dir="ltr" className="break-all text-xs text-amber-300">
                        {tx('נכשל: {why}', { why: g.error })}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
            {(() => {
              const g = got[`chirp+n|${s}`] ?? got[`gemini+n|${s}`]
              return g && 'said' in g ? <p className="text-sm text-slate-300">{g.said}</p> : null
            })()}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => void copy()} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200">
        <Copy size={16} aria-hidden />
        {copied ? tx('הועתק') : tx('העתק תוצאות')}
      </button>
    </div>
  )
}
