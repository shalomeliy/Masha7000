// Spike (the owner, 2026-11-23, thread "לשפר את הקול העברי של Shali"): which Hebrew voice sounds right?
// One sentence in four versions: Chirp 3 HD as today, Chirp 3 HD given niqqud, Gemini TTS, Gemini TTS
// given niqqud. A Hebrew TTS bake-off (2026-11-18) found that every voice that passed did so only with
// niqqud, so the niqqud is added here by Dicta's free Nakdan before the voice reads it.
// Throwaway: the owner picks by ear, then the winner is built properly (or this is removed).

import { synthesize } from './tts.js'
import { addNikud, geminiSpeak } from './gemini.js'

export { addNikud, listVoices, pcmToWav } from './gemini.js'

export type Engine = 'chirp' | 'gemini'
export interface CompareRequest {
  text: string
  engine: Engine
  nikud: boolean
  voice: string // Gemini only: a Voice Library id; Chirp always uses Shali's voice
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

export function readCompareRequest(body: Record<string, unknown> | null): CompareRequest | null {
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text || text.length > MAX) return null
  const engine = body?.engine === 'gemini' ? 'gemini' : body?.engine === 'chirp' ? 'chirp' : null
  if (!engine) return null
  const v = typeof body?.voice === 'string' ? body.voice.trim() : ''
  const voice = /^[\w.:/-]{1,120}$/.test(v) ? v : VOICE
  return { text, engine, nikud: body?.nikud === true, voice }
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
      : await geminiSpeak(said, req.voice, keys.gemini, fetchFn)
  return { audio: Buffer.from(spoken.bytes).toString('base64'), mime: spoken.mime, engine: spoken.engine, said, msNikud, msVoice: Date.now() - t }
}
