import type { Env } from './env.js'
import { kv } from './kv.js'

// Speech to text on the server, for the iPhone home-screen app, where the page cannot recognize speech
// (WebKit bug 225298). The phone records 16 kHz mono 16-bit WAV (the iPhone's own audio/mp4 is AAC, which
// Google's v1 does not take), and one of two services turns it into text. The owner's choice, 2026-11-23:
// start with Google Cloud Speech-to-Text (paid by the trial credit until ~Feb 2027), move to OpenAI later
// by changing STT_PROVIDER in Vercel, with no code change. Both take the same WAV.
// Hard stop: seconds of audio per calendar month (UTC), refused from STT_MONTHLY_SECONDS on (default 3,000:
// 50 minutes, about $0.80 at Google's $0.016 a minute).

export type SttProvider = 'google' | 'openai' | 'israel'
export const MAX_STT_SECONDS = 30
const WAV_HEADER = 44
const BYTES_PER_SECOND = 16_000 * 2

// 'israel' (2026-11-28): the ivrit.ai streaming Hebrew model on Cloud Run Tel Aviv (spikes/zipformer-il,
// docs/spikes/israel-stt.md). Needs ISRAEL_STT_URL and ISRAEL_STT_TOKEN; when it fails, hearRecording
// falls back to Google. Off unless STT_PROVIDER=israel.
export function sttProvider(e: NodeJS.ProcessEnv = process.env): SttProvider {
  const p = (e.STT_PROVIDER ?? '').trim().toLowerCase()
  return p === 'openai' ? 'openai' : p === 'israel' ? 'israel' : 'google'
}

export function israelSttUrl(e: NodeJS.ProcessEnv = process.env): string {
  return (e.ISRAEL_STT_URL ?? '').trim().replace(/\/+$/, '')
}

/** The provider's key, or '' when it is not set. Google's is the cloud-voice key, allowed for both APIs. */
export function sttKey(provider: SttProvider, e: NodeJS.ProcessEnv = process.env): string {
  if (provider === 'israel') return israelSttUrl(e) ? (e.ISRAEL_STT_TOKEN ?? '').trim() : ''
  return ((provider === 'openai' ? e.OPENAI_API_KEY : e.GOOGLE_TTS_API_KEY) ?? '').trim()
}

export function sttMonthlyLimit(e: NodeJS.ProcessEnv = process.env): number {
  const n = Number((e.STT_MONTHLY_SECONDS ?? '').trim())
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3_000
}

const KEEP = 70 * 86_400
const secondsKey = (now: Date) => `stt-seconds:${now.toISOString().slice(0, 7)}`

/** The body checked: { audio: base64 WAV, 16 kHz mono 16-bit, up to 30 seconds, lang: 'he-IL' (default) }. */
export function readSttRequest(body: Record<string, unknown> | null): { wav: Buffer; seconds: number; lang: string } | null {
  const audio = typeof body?.audio === 'string' ? body.audio : ''
  if (!audio) return null
  const wav = Buffer.from(audio, 'base64')
  if (wav.length <= WAV_HEADER || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return null
  if (wav.readUInt16LE(22) !== 1 || wav.readUInt32LE(24) !== 16_000 || wav.readUInt16LE(34) !== 16) return null
  const seconds = (wav.length - WAV_HEADER) / BYTES_PER_SECOND
  if (seconds > MAX_STT_SECONDS) return null
  const lang = typeof body?.lang === 'string' && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(body.lang) ? body.lang : 'he-IL'
  return { wav, seconds, lang }
}

/** Counts the seconds first (rounded up, as billed), then says whether this month is still under the limit. */
export async function takeSeconds(env: Env, seconds: number, now = new Date(), e: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const add = Math.max(1, Math.ceil(seconds))
  const key = secondsKey(now)
  const used = await kv.incrBy(env, key, add)
  if (used === add) await kv.expire(env, key, KEEP)
  return used <= sttMonthlyLimit(e)
}

/** The text heard, '' when nothing was said. Throws with the status on any failure. */
/** `lang` as the app's speech language, 'he-IL'. */
export async function transcribe(provider: SttProvider, apiKey: string, wav: Buffer, lang = 'he-IL', fetchFn: typeof fetch = fetch, e: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (provider === 'israel') {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav')
    const res = await fetchFn(`${israelSttUrl(e)}/stt`, {
      method: 'POST',
      headers: { 'X-Stt-Token': apiKey },
      body: form,
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) throw new Error(`israel stt ${res.status}`)
    return (((await res.json()) as { text?: string }).text ?? '').trim()
  }
  if (provider === 'openai') {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav')
    form.append('model', 'gpt-4o-mini-transcribe')
    form.append('language', lang.slice(0, 2))
    const res = await fetchFn('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`openai stt ${res.status}`)
    return (((await res.json()) as { text?: string }).text ?? '').trim()
  }
  const res = await fetchFn('https://speech.googleapis.com/v1/speech:recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
    body: JSON.stringify({
      config: { encoding: 'LINEAR16', sampleRateHertz: 16_000, languageCode: lang },
      audio: { content: wav.subarray(WAV_HEADER).toString('base64') },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`google stt ${res.status} ${(await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 700)}`)
  const { results } = (await res.json()) as { results?: { alternatives?: { transcript?: string }[] }[] }
  return (results ?? [])
    .map((r) => r.alternatives?.[0]?.transcript ?? '')
    .join(' ')
    .trim()
}

/** Wakes the Israel service (it sleeps when idle; the first call after a rest took ~6 s, 2026-11-28). Best effort. */
export async function warmIsrael(apiKey: string, fetchFn: typeof fetch = fetch, e: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  try {
    const res = await fetchFn(`${israelSttUrl(e)}/health`, { headers: { 'X-Stt-Token': apiKey }, signal: AbortSignal.timeout(15_000) })
    return res.ok
  } catch {
    return false
  }
}
