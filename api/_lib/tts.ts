import type { Env } from './env.js'
import { kv } from './kv.js'
import { addNikud, geminiSpeak } from './gemini.js'
import { open, seal, sha256url } from './crypto.js'

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

export const mp3 = (bytes: Uint8Array<ArrayBuffer>, type = 'audio/mpeg') =>
  new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' } })

// Since 2026-11-23 (the owner's pick by ear): with GEMINI_API_KEY set, Shali speaks with Gemini TTS
// given Dicta's niqqud (gemini.ts); TTS_ENGINE=chirp turns it back to Chirp alone. Gemini takes ~2.5 s a
// sentence against Chirp's ~0.8 s, so it gets GEMINI_BUDGET_MS in all (niqqud included); anything slower
// or failing (the free tier's 429, Dicta down) is read by Chirp in the same request, so Shali never waits
// long or goes silent. Niqqud failing alone still lets Gemini read the plain text.
const GEMINI_BUDGET_MS = 4500
const NIKUD_MS = 1500

export function voiceEngine(e: NodeJS.ProcessEnv = process.env): { geminiKey: string; geminiVoice: string } | null {
  const key = (e.GEMINI_API_KEY ?? '').trim()
  if (!key || (e.TTS_ENGINE ?? '').trim().toLowerCase() === 'chirp') return null
  const v = (e.GEMINI_VOICE ?? '').trim()
  return { geminiKey: key, geminiVoice: /^[\w.:/-]{1,120}$/.test(v) ? v : 'Sadaltager' }
}

/** One sentence as audio: Gemini with niqqud when configured, else (or on any trouble) Chirp. */
export async function speakBest(
  apiKey: string,
  req: TtsRequest,
  gemini: { geminiKey: string; geminiVoice: string } | null,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string; engine: 'gemini' | 'chirp' }> {
  if (gemini) {
    const start = now()
    try {
      let said = req.text
      try {
        said = await addNikud(req.text, fetchFn, NIKUD_MS)
      } catch (e) {
        console.error('nikud failed', (e as Error).message?.slice(0, 200))
      }
      const left = Math.max(1000, GEMINI_BUDGET_MS - (now() - start))
      const { bytes } = await geminiSpeak(said, gemini.geminiVoice, gemini.geminiKey, fetchFn, left)
      return { bytes: new Uint8Array(bytes), type: 'audio/wav', engine: 'gemini' }
    } catch (e) {
      console.error('gemini tts failed, Chirp instead', (e as Error).message?.slice(0, 200))
    }
  }
  return { bytes: await synthesize(apiKey, req, fetchFn), type: 'audio/mpeg', engine: 'chirp' }
}


// Pay for a sentence once (the owner, 2026-11-23; docs/GOAL.md "The voice costs too"): Shali says many
// sentences word for word ("רגע, בודק", "אשר או תקן", read-backs), so the audio of each short sentence is
// kept, sealed, for CACHE_DAYS and replayed: no Google call, no characters counted, and it plays at once.
// Only audio from the engine that should speak is kept (a Chirp fallback is not, so Gemini gets its turn
// next time), and the key holds the engine and voice, so changing either starts fresh. Short sentences
// only, which is what repeats and keeps each entry small (Gemini's WAV is ~48 KB a second).
export const CACHE_MAX_CHARS = 120
const CACHE_DAYS = 30
const CACHE_MAX_BYTES = 600_000

export function cacheTarget(req: TtsRequest, gemini: { geminiVoice: string } | null): string {
  return gemini ? `gemini|${gemini.geminiVoice}` : `chirp|${req.voice}|${req.rate}`
}

const cacheKey = async (env: Env, target: string, text: string) => `tts-cache:${await sha256url(`${env.sessionKey}|${target}|${text}`)}`

export async function readCachedVoice(env: Env, req: TtsRequest, target: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | null> {
  if (req.text.length > CACHE_MAX_CHARS) return null
  try {
    const kept = await open<{ type: string; audio: string }>(env.sessionKey, await kv.get(env, await cacheKey(env, target, req.text)))
    return kept ? { bytes: new Uint8Array(Buffer.from(kept.audio, 'base64')), type: kept.type } : null
  } catch {
    return null
  }
}

export async function keepVoice(env: Env, req: TtsRequest, target: string, spoken: { bytes: Uint8Array; type: string; engine: string }): Promise<void> {
  if (req.text.length > CACHE_MAX_CHARS || spoken.bytes.length > CACHE_MAX_BYTES || !target.startsWith(spoken.engine)) return
  try {
    const value = await seal(env.sessionKey, { type: spoken.type, audio: Buffer.from(spoken.bytes).toString('base64') })
    await kv.set(env, await cacheKey(env, target, req.text), value, CACHE_DAYS * 86_400)
  } catch (e) {
    console.error('tts cache keep failed', (e as Error).message?.slice(0, 200))
  }
}
