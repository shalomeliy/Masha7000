import { language, tx } from '../i18n'
import { vlog } from './voiceLog'
import { blobBase64, level, toWav } from './wav'

// Listening in the iPhone home-screen app (the owner, 2026-11-23). Apple gives the page no speech
// recognition there (WebKit bug 225298), but the microphone works: the sound is recorded here, and
// the server turns it into text (POST /api/assistant?stt, Google now, OpenAI later; api/_lib/stt.ts).
// Ends by itself after a pause once something was said (the owner's choice), or at once on a second tap.
// Spike 2026-11-23 on the owner's iPhone 11: "יוסי חולה מחר" right, 1.8 s for 5 seconds of speech.

const SILENCE_MS = 1500 // quiet this long after speaking: done
const NOTHING_MS = 8000 // nothing said at all: give up
const MAX_MS = 29_000 // the server takes up to 30 seconds
const WARMUP = 3 // the first pieces (~85 ms each): the iPhone's mic may click or rise as it starts
const MIN_LOUD = 0.015 // speech is at least this loud, however quiet the room
// The room's noise is the quiet end of what was heard so far (a low share of the pieces), not the loudest
// moment at the start: on the owner's iPhone (2026-11-23) a start that took the first pieces as "noise"
// set the bar above his voice, and two tries in a row ended with "nothing said".
const QUIET_SHARE = 0.2

export interface ServerListening {
  stop: () => void
}

type Ctx = typeof AudioContext

/** True where the microphone can be recorded raw (getUserMedia and Web Audio). */
export function canRecord(): boolean {
  const w = window as unknown as { AudioContext?: Ctx; webkitAudioContext?: Ctx }
  return typeof navigator.mediaDevices?.getUserMedia === 'function' && Boolean(w.AudioContext ?? w.webkitAudioContext)
}

const REASONS: Record<string, string> = {
  'over-budget': tx('זיהוי הדיבור הגיע למכסה של החודש. אפשר להקליד במקום.'),
  'too-many': tx('יותר מדי בקשות בזמן קצר. נסה שוב בעוד כמה דקות.'),
}

/**
 * Call inside the tap: an iPhone keeps an AudioContext made later silent. `onText` gets "מזהה..." while
 * the server works; `onEnd` gets the words (maybe empty), or an error message.
 */
export function listenViaServer(onText: (text: string) => void, onEnd: (text: string, error?: string) => void): ServerListening {
  const w = window as unknown as { AudioContext?: Ctx; webkitAudioContext?: Ctx }
  const ctx = new (w.AudioContext ?? w.webkitAudioContext)!()
  const pieces: Float32Array[] = []
  let stream: MediaStream | null = null
  let stopped = false
  let ended = false
  let spoke = false
  let lastLoud = 0
  let heard = 0 // pieces heard so far
  let loudest = 0
  const levels: number[] = []
  const noiseFloor = () => {
    if (!levels.length) return 0
    const sorted = [...levels].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length * QUIET_SHARE)]
  }
  const started = Date.now()
  const timers: ReturnType<typeof setTimeout>[] = []

  const end = (text: string, error?: string) => {
    if (ended) return
    ended = true
    vlog(`server-listen: end, ${text.length} chars${error ? `, error` : ''}`)
    onEnd(text, error)
  }

  const release = () => {
    timers.forEach(clearTimeout)
    stream?.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => {})
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    release()
    const seconds = pieces.reduce((n, p) => n + p.length, 0) / ctx.sampleRate
    vlog(`server-listen: stop after ${seconds.toFixed(1)}s, spoke=${spoke}, loudest ${loudest.toFixed(3)}, noise ${noiseFloor().toFixed(3)}`)
    // Not sure it was speech, but something loud was heard: the server decides (a few seconds cost little).
    if (seconds < 0.3 || (!spoke && loudest < MIN_LOUD)) return end('', tx('לא נשמע דיבור. נסה שוב.'))
    onText(tx('מזהה...'))
    void send(toWav(pieces, ctx.sampleRate)).then(
      (text) => end(text),
      (e: Error) => end('', REASONS[e.message] ?? tx('זיהוי הדיבור לא הצליח. אפשר להקליד במקום.')),
    )
  }

  void (async () => {
    try {
      await ctx.resume()
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (e) {
      vlog(`server-listen: mic ${(e as Error).name}`)
      stopped = true
      release()
      return end('', tx('אין הרשאה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן.'))
    }
    if (stopped) return release()
    // ScriptProcessor is old but runs on every iPhone; it only runs when connected to the output,
    // so through a silent gain.
    const tap = ctx.createScriptProcessor(4096, 1, 1)
    const mute = ctx.createGain()
    mute.gain.value = 0
    tap.onaudioprocess = (e) => {
      if (stopped) return
      const piece = new Float32Array(e.inputBuffer.getChannelData(0))
      pieces.push(piece)
      const l = level(piece)
      if (++heard <= WARMUP) return
      levels.push(l)
      loudest = Math.max(loudest, l)
      const now = Date.now()
      const noise = noiseFloor()
      // Capped, so a long stretch of talk with few pauses never lifts the bar above the voice itself.
      if (l > Math.max(MIN_LOUD, Math.min(noise * 3, 0.04))) {
        if (!spoke) vlog(`server-listen: speech at ${((now - started) / 1000).toFixed(1)}s (noise ${noise.toFixed(3)}, level ${l.toFixed(3)})`)
        spoke = true
        lastLoud = now
      } else if (spoke && now - lastLoud > SILENCE_MS) stop()
    }
    ctx.createMediaStreamSource(stream).connect(tap)
    tap.connect(mute)
    mute.connect(ctx.destination)
    vlog(`server-listen: start ${ctx.sampleRate} Hz`)
    timers.push(setTimeout(() => !spoke && stop(), NOTHING_MS))
    timers.push(setTimeout(stop, MAX_MS))
  })()

  return { stop }
}

async function send(wav: Blob): Promise<string> {
  const res = await fetch('/api/assistant?stt', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: await blobBase64(wav), lang: language().speech }),
  })
  const data = (await res.json().catch(() => ({}))) as { text?: string; ms?: number; reason?: string; detail?: string }
  if (!res.ok) {
    vlog(`server-listen: refused ${res.status} ${data.reason ?? ''} ${(data.detail ?? '').slice(0, 120)}`)
    throw new Error(data.reason ?? String(res.status))
  }
  vlog(`server-listen: text ${data.text?.length ?? 0} chars, server ${data.ms} ms`)
  return data.text ?? ''
}
