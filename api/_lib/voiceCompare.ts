// Spike (the owner, 2026-11-23, thread "לשפר את הקול העברי של Shali"): which Hebrew voice sounds right?
// One sentence in four versions: Chirp 3 HD as today, Chirp 3 HD given niqqud, Gemini TTS, Gemini TTS
// given niqqud. A Hebrew TTS bake-off (2026-11-18) found that every voice that passed did so only with
// niqqud, so the niqqud is added here by Dicta's free Nakdan before the voice reads it.
// Throwaway: the owner picks by ear, then the winner is built properly (or this is removed).

import { synthesize } from './tts.js'

export type Engine = 'chirp' | 'gemini'
export interface CompareRequest {
  text: string
  engine: Engine
  nikud: boolean
}
export interface CompareResult {
  audio: string // base64
  mime: string
  engine: string // which model actually spoke
  said: string // the text the voice was given (with niqqud when asked)
  msNikud: number
  msVoice: number
}

const MAX = 300
const VOICE = 'Sadaltager' // Shali's default male voice; Gemini TTS has the same name
const PROMPT = 'Read this Hebrew text aloud exactly as written, in modern Israeli Hebrew, as a calm, friendly, professional man.'

export function readCompareRequest(body: Record<string, unknown> | null): CompareRequest | null {
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text || text.length > MAX) return null
  const engine = body?.engine === 'gemini' ? 'gemini' : body?.engine === 'chirp' ? 'chirp' : null
  if (!engine) return null
  return { text, engine, nikud: body?.nikud === true }
}

const NAKDAN = 'https://nakdan-2-0.loadbalancer.dicta.org.il/api'
type NakdanWord = { word?: unknown; sep?: unknown; options?: unknown }

/** The text with niqqud from Dicta's Nakdan: each word's first option, separators as they are. */
export async function addNikud(text: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(NAKDAN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'nakdan', genre: 'modern', data: text, addmorph: false, keepqq: false }),
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new Error(`nakdan ${res.status}`)
  const words = (await res.json()) as NakdanWord[]
  if (!Array.isArray(words)) throw new Error('nakdan shape')
  return words
    .map((w) => {
      const word = typeof w.word === 'string' ? w.word : ''
      if (w.sep === true || !Array.isArray(w.options) || typeof w.options[0] !== 'string') return word
      return (w.options[0] as string).replace(/\|/g, '')
    })
    .join('')
}

/** 16-bit mono PCM (Gemini API's output) wrapped as a WAV file. */
export function pcmToWav(pcm: Uint8Array, rate = 24_000): Uint8Array {
  const out = new Uint8Array(44 + pcm.length)
  const v = new DataView(out.buffer)
  const s = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  s(0, 'RIFF')
  v.setUint32(4, 36 + pcm.length, true)
  s(8, 'WAVE')
  s(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  s(36, 'data')
  v.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return out
}

/**
 * Gemini TTS. With GEMINI_API_KEY (from Google AI Studio) it uses the Gemini API's newest cheap model;
 * otherwise the Cloud Text-to-Speech API with Shali's existing key (needs Vertex AI allowed on the project).
 */
async function gemini(text: string, ttsKey: string, geminiKey: string, fetchFn: typeof fetch): Promise<{ bytes: Uint8Array; mime: string; engine: string }> {
  if (geminiKey) {
    const model = 'gemini-3.8-flash-lite-tts'
    const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${PROMPT}\n\n${text}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`gemini api ${res.status} ${(await res.text()).slice(0, 300)}`)
    const data = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] }
    const b64 = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data
    if (!b64) throw new Error('gemini api empty')
    return { bytes: pcmToWav(new Uint8Array(Buffer.from(b64, 'base64'))), mime: 'audio/wav', engine: model }
  }
  const model = 'gemini-3.1-flash-tts-preview'
  const res = await fetchFn('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': ttsKey },
    body: JSON.stringify({
      input: { text, prompt: PROMPT },
      voice: { languageCode: 'he-IL', name: VOICE, modelName: model },
      audioConfig: { audioEncoding: 'MP3' },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`cloud gemini ${res.status} ${(await res.text()).slice(0, 300)}`)
  const { audioContent } = (await res.json()) as { audioContent?: string }
  if (!audioContent) throw new Error('cloud gemini empty')
  return { bytes: new Uint8Array(Buffer.from(audioContent, 'base64')), mime: 'audio/mpeg', engine: model }
}

export async function compareVoice(
  req: CompareRequest,
  keys: { tts: string; gemini: string },
  fetchFn: typeof fetch = fetch,
): Promise<CompareResult> {
  let t = Date.now()
  const said = req.nikud ? await addNikud(req.text, fetchFn) : req.text
  const msNikud = req.nikud ? Date.now() - t : 0
  t = Date.now()
  const spoken =
    req.engine === 'chirp'
      ? { bytes: await synthesize(keys.tts, { text: said, voice: VOICE, rate: 1 }, fetchFn), mime: 'audio/mpeg', engine: 'chirp3-hd' }
      : await gemini(said, keys.tts, keys.gemini, fetchFn)
  return { audio: Buffer.from(spoken.bytes).toString('base64'), mime: spoken.mime, engine: spoken.engine, said, msNikud, msVoice: Date.now() - t }
}
