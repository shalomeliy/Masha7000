import { useEffect, useRef, useState } from 'react'
import { Copy, Loader2, Mic } from 'lucide-react'
import { tx } from '../../i18n'

// Stage 0 of the speech-to-text upgrade (the user, 2026-11-21): does MediaRecorder record real sound
// inside the iPhone home-screen app, where the page has no speech recognition (WebKit bug 225298)?
// Records 5 seconds, then shows the format the phone picked, the size in bytes, the loudest moment
// heard, and plays the recording back. Nothing is sent unless "זהה טקסט" is pressed (stage 2, below).
// Throwaway: goes once the real recorder is built.

const SECONDS = 5
// The first format the phone can record in: iPhone has only audio/mp4, the others webm/opus.
const FORMATS = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/aac', 'audio/ogg;codecs=opus']

type Result = { lines: string[]; url: string | null; wav: Blob | null }
type Heard = { text: string; info: string } | { error: string }

// Stage 2 spike (the owner, 2026-11-23): the same 5 seconds, also taken as raw sound and made into a
// 16 kHz mono WAV, sent to the server (/api/assistant?stt), which asks Google (later OpenAI) for the text.
// WAV and not the recorder's audio/mp4: Google's speech service does not take AAC.
const RATE = 16_000

function toWav(parts: Float32Array[], fromRate: number): Blob {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const all = new Float32Array(total)
  let at = 0
  for (const p of parts) {
    all.set(p, at)
    at += p.length
  }
  const step = fromRate / RATE
  const n = Math.floor(total / step)
  const out = new DataView(new ArrayBuffer(44 + n * 2))
  const text = (o: number, t: string) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  out.setUint32(4, 36 + n * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true)
  out.setUint16(22, 1, true)
  out.setUint32(24, RATE, true)
  out.setUint32(28, RATE * 2, true)
  out.setUint16(32, 2, true)
  out.setUint16(34, 16, true)
  text(36, 'data')
  out.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    // The average of the samples this one stands for: a simple low-pass before dropping the rate.
    const from = Math.floor(i * step)
    const to = Math.max(from + 1, Math.floor((i + 1) * step))
    let sum = 0
    for (let j = from; j < to; j++) sum += all[j] ?? 0
    const v = Math.max(-1, Math.min(1, sum / (to - from)))
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  return new Blob([out.buffer], { type: 'audio/wav' })
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const standalone = () =>
  (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true

export function MicTestSection() {
  const [state, setState] = useState<'idle' | 'recording'>('idle')
  const [left, setLeft] = useState(SECONDS)
  const [result, setResult] = useState<Result | null>(null)
  const [copied, setCopied] = useState(false)
  const [heard, setHeard] = useState<Heard | null>(null)
  const [hearing, setHearing] = useState(false)
  const url = useRef<string | null>(null)
  useEffect(() => () => void (url.current && URL.revokeObjectURL(url.current)), [])

  const run = async () => {
    setResult(null)
    setHeard(null)
    setCopied(false)
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = null
    const lines: string[] = [
      `standalone (PWA): ${standalone()}`,
      `MediaRecorder: ${typeof MediaRecorder !== 'undefined'}`,
      `userAgent: ${navigator.userAgent}`,
    ]
    const fail = (where: string, e: unknown) => {
      const err = e as { name?: string; message?: string }
      lines.push(`${where}: ${err?.name ?? ''} ${err?.message ?? String(e)}`.trim())
      setResult({ lines, url: null, wav: null })
      setState('idle')
    }
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) return fail('error', 'no MediaRecorder / getUserMedia')

    // The AudioContext is made here, inside the tap: iPhone keeps one made later suspended (silent).
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    const ctx = Ctx ? new Ctx() : null
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      void ctx?.close()
      return fail('getUserMedia', e)
    }
    const picked = FORMATS.find((f) => MediaRecorder.isTypeSupported?.(f)) ?? ''
    lines.push(`supported: ${FORMATS.filter((f) => MediaRecorder.isTypeSupported?.(f)).join(', ') || '-'}`)
    lines.push(`picked: ${picked || '(browser default)'}`)

    // The loudest moment heard, 0..1: near 0 means the recording is silent even if it has bytes.
    let peak = 0
    let timer = 0
    const pcm: Float32Array[] = []
    let rate = 0
    if (ctx) {
      try {
        await ctx.resume()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        ctx.createMediaStreamSource(stream).connect(analyser)
        const buf = new Float32Array(analyser.fftSize)
        timer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(buf)
          for (const v of buf) peak = Math.max(peak, Math.abs(v))
        }, 100)
        lines.push(`AudioContext: ${ctx.state}, ${ctx.sampleRate} Hz`)
        // The raw sound for the WAV. ScriptProcessor is old but runs on every iPhone; it only runs when
        // connected to the output, so through a silent gain.
        const tap = ctx.createScriptProcessor(4096, 1, 1)
        const mute = ctx.createGain()
        mute.gain.value = 0
        tap.onaudioprocess = (e) => pcm.push(new Float32Array(e.inputBuffer.getChannelData(0)))
        ctx.createMediaStreamSource(stream).connect(tap)
        tap.connect(mute)
        mute.connect(ctx.destination)
        rate = ctx.sampleRate
      } catch (e) {
        lines.push(`AudioContext: ${(e as Error).message}`)
      }
    }

    let rec: MediaRecorder
    try {
      rec = picked ? new MediaRecorder(stream, { mimeType: picked }) : new MediaRecorder(stream)
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop())
      void ctx?.close()
      return fail('MediaRecorder', e)
    }
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
    rec.onerror = (e) => lines.push(`recorder error: ${(e as unknown as { error?: Error }).error?.message ?? 'unknown'}`)
    rec.onstop = () => {
      window.clearInterval(timer)
      stream.getTracks().forEach((t) => t.stop())
      void ctx?.close()
      const type = rec.mimeType || picked || chunks[0]?.type || ''
      const blob = new Blob(chunks, type ? { type } : undefined)
      lines.push(`recorder.mimeType: ${rec.mimeType || '-'}`)
      lines.push(`chunks: ${chunks.length}`)
      lines.push(`bytes: ${blob.size}`)
      lines.push(`peak level: ${peak.toFixed(3)}`)
      const wav = pcm.length && rate ? toWav(pcm, rate) : null
      lines.push(`wav bytes: ${wav?.size ?? 0}`)
      url.current = blob.size > 0 ? URL.createObjectURL(blob) : null
      setResult({ lines, url: url.current, wav })
      setState('idle')
    }
    // Pieces every second: iPhone has dropped the last piece of a recording asked for in one go.
    rec.start(1000)
    setState('recording')
    setLeft(SECONDS)
    for (let s = SECONDS - 1; s >= 0; s--) {
      await new Promise((r) => setTimeout(r, 1000))
      setLeft(s)
    }
    if (rec.state !== 'inactive') rec.stop()
  }

  const bytes = Number(result?.lines.find((l) => l.startsWith('bytes: '))?.slice(7) ?? 0)
  const peak = Number(result?.lines.find((l) => l.startsWith('peak level: '))?.slice(12) ?? 0)
  const verdict = !result
    ? null
    : bytes === 0
      ? tx('ההקלטה ריקה: לא נקלט שום דבר.')
      : peak < 0.01
        ? tx('יש קובץ, אבל נשמע שקט. אם דיברת, ייתכן שהמיקרופון לא נקלט.')
        : tx('ההקלטה עבדה. לחץ על נגן כדי לשמוע אותה.')

  const hear = async () => {
    if (!result?.wav) return
    setHearing(true)
    setHeard(null)
    const started = performance.now()
    try {
      const res = await fetch('/api/assistant?stt', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: await base64(result.wav) }),
      })
      const data = (await res.json().catch(() => ({}))) as { text?: string; provider?: string; ms?: number; reason?: string; detail?: string }
      const total = Math.round(performance.now() - started)
      if (res.ok) setHeard({ text: data.text ?? '', info: `${data.provider} · server ${data.ms} ms · total ${total} ms` })
      else setHeard({ error: `${res.status} ${data.reason ?? ''} ${data.provider ?? ''} ${data.detail ?? ''}`.trim() })
    } catch (e) {
      setHeard({ error: (e as Error).message })
    }
    setHearing(false)
  }

  const copy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(
        [...result.lines, ...(heard ? ['text' in heard ? `stt: ${heard.info} | ${heard.text}` : `stt error: ${heard.error}`] : [])].join('\n'),
      )
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{tx('בדיקת הקלטה')}</h2>
        <p className="text-sm text-slate-300">
          {tx('מקליטה 5 שניות ומשמיעה אותן. ההקלטה נשלחת לגוגל רק אם לוחצים "זהה טקסט". בפעם הראשונה הטלפון ישאל על המיקרופון: צריך לאשר.')}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void run()}
        disabled={state === 'recording'}
        className={`flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm ${
          state === 'recording' ? 'border-red-500 bg-red-500/15 text-red-200' : 'border-slate-700 text-slate-200'
        }`}
      >
        {state === 'recording' ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Mic size={18} aria-hidden />}
        {state === 'recording' ? tx('מקליט... עוד {v} שניות. דבר עכשיו', { v: left }) : tx('הקלט 5 שניות')}
      </button>
      {result && (
        <div className="space-y-3">
          {verdict && (
            <p role="status" className={`text-sm ${bytes > 0 && peak >= 0.01 ? 'text-emerald-300' : 'text-amber-300'}`}>
              {verdict}
            </p>
          )}
          {result.url && <audio controls src={result.url} className="w-full" />}
          {result.wav && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void hear()}
                disabled={hearing}
                className="flex min-h-11 items-center gap-2 rounded-xl border border-sky-600 px-4 text-sm text-sky-200"
              >
                {hearing ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Mic size={16} aria-hidden />}
                {tx('זהה טקסט (נשלח לגוגל)')}
              </button>
              {heard && 'text' in heard && (
                <div role="status" className="space-y-1">
                  <p className="text-base text-emerald-200">{heard.text || tx('לא זוהו מילים')}</p>
                  <p dir="ltr" className="text-xs text-slate-400">
                    {heard.info}
                  </p>
                </div>
              )}
              {heard && 'error' in heard && (
                <p role="status" dir="ltr" className="break-all text-sm text-amber-300">
                  {heard.error}
                </p>
              )}
            </div>
          )}
          <pre dir="ltr" className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-200">
            {[...result.lines, ...(heard ? ['text' in heard ? `stt: ${heard.info} | ${heard.text}` : `stt error: ${heard.error}`] : [])].join('\n')}
          </pre>
          <button type="button" onClick={() => void copy()} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200">
            <Copy size={16} aria-hidden />
            {copied ? tx('הועתק') : tx('העתק תוצאות')}
          </button>
        </div>
      )}
    </div>
  )
}
