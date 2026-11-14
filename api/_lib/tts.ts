import type { Env } from './env.js'
import { kv } from './kv.js'

// Shali's cloud voice (the owner's choice, 2026-11-13/14): Google Cloud Text-to-Speech, Chirp 3 HD
// Hebrew, a male voice. One sentence at a time comes in, MP3 goes back.
// Google has no monthly character limit for this service, and its Billing "spend caps" do not cover it
// (checked in the owner's console 2026-11-13), so the hard stop is this counter: characters per calendar
// month (UTC), refused from TTS_MONTHLY_CHARS on (default 900,000, under the 1,000,000 free a month).
// When refused, the phone speaks with its own voice, so Shali is never silent.
// The key (GOOGLE_TTS_API_KEY) is restricted in Google to this API only and lives only on the server.

/** Male Chirp 3 HD voices offered on the assistant screen; the first is the default. */
export const CLOUD_VOICES = ['Sadaltager', 'Achird', 'Charon', 'Umbriel', 'Iapetus', 'Algieba'] as const
export const MAX_TTS_CHARS = 600

export function ttsMonthlyLimit(e: NodeJS.ProcessEnv = process.env): number {
  const n = Number((e.TTS_MONTHLY_CHARS ?? '').trim())
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 900_000
}

const KEEP = 70 * 86_400
const charsKey = (now: Date) => `tts-chars:${now.toISOString().slice(0, 7)}`

export interface TtsRequest {
  text: string
  voice: (typeof CLOUD_VOICES)[number]
  rate: number
}

/** The body checked: text 1..600 chars, a known voice (else the default), rate 0.5..2 (else 1). */
export function readTtsRequest(body: Record<string, unknown> | null): TtsRequest | null {
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text || text.length > MAX_TTS_CHARS) return null
  const voice = CLOUD_VOICES.find((v) => v === body?.voice) ?? CLOUD_VOICES[0]
  const r = Number(body?.rate)
  const rate = Number.isFinite(r) && r >= 0.5 && r <= 2 ? r : 1
  return { text, voice, rate }
}

/**
 * Counts the characters first (a failed call still counts: it may have been billed), then says whether
 * this month is still under the limit. Counting before calling means even a loop cannot pass the limit
 * by more than one sentence.
 */
export async function takeChars(env: Env, chars: number, now = new Date(), e: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const key = charsKey(now)
  const used = await kv.incrBy(env, key, chars)
  if (used === chars) await kv.expire(env, key, KEEP)
  return used <= ttsMonthlyLimit(e)
}

export async function readCharsUsed(env: Env, now = new Date()): Promise<number> {
  return Number((await kv.get(env, charsKey(now))) ?? 0)
}

/** Asks Google for the sentence as MP3. Throws with the status on any failure. */
export async function synthesize(apiKey: string, req: TtsRequest, fetchFn: typeof fetch = fetch): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetchFn('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
    body: JSON.stringify({
      input: { text: req.text },
      voice: { languageCode: 'he-IL', name: `he-IL-Chirp3-HD-${req.voice}` },
      audioConfig: { audioEncoding: 'MP3', speakingRate: req.rate },
    }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`google tts ${res.status}`)
  const { audioContent } = (await res.json()) as { audioContent?: string }
  if (!audioContent) throw new Error('google tts empty')
  return new Uint8Array(Buffer.from(audioContent, 'base64'))
}

export const mp3 = (bytes: Uint8Array<ArrayBuffer>) =>
  new Response(bytes, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=86400' } })
