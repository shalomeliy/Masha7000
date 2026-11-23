// Shali's Gemini voice (the owner's pick, 2026-11-23, after the voice-compare spike): Dicta's Nakdan adds
// niqqud, then Gemini 3.8 Flash-Lite TTS reads it. A Hebrew TTS bake-off (2026-11-18) found every voice
// that passed did so only with niqqud. The owner chose Dicta's free Nakdan over hosting a model (the
// sentence, names too, goes to Dicta). The key is GEMINI_API_KEY from Google AI Studio.

const NAKDAN = 'https://nakdan-2-0.loadbalancer.dicta.org.il/api'
type NakdanWord = { word?: unknown; sep?: unknown; options?: unknown }

/** The text with niqqud from Dicta's Nakdan: each word's first option, separators as they are. */
export async function addNikud(text: string, fetchFn: typeof fetch = fetch, ms = 6000): Promise<string> {
  const res = await fetchFn(NAKDAN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'nakdan', genre: 'modern', data: text, addmorph: false, keepqq: false }),
    signal: AbortSignal.timeout(ms),
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

// Gemini 3.8 TTS reads the text field word for word, so the style goes in speech_metadata (owner,
// 2026-11-23: the old prompt-in-text was read aloud). The accent comes from the voice itself, not the
// style: Google's own advice is to pick a regional voice from its Voice Library (listVoices below).
const STYLE = 'calm, friendly, professional; casual everyday Israeli speech'

/** Hebrew male voices from Gemini's Voice Library (free to list): id, name, accent, description. */
export async function listVoices(geminiKey: string, fetchFn: typeof fetch = fetch): Promise<{ id: string; name: string; info: string }[]> {
  const male = await askVoices(geminiKey, { language_code: 'he-IL', gender: 'male' }, fetchFn)
  return male.length ? male : askVoices(geminiKey, { region_code: 'IL' }, fetchFn)
}

async function askVoices(geminiKey: string, filter: Record<string, string>, fetchFn: typeof fetch): Promise<{ id: string; name: string; info: string }[]> {
  const q = new URLSearchParams({ ...filter, page_size: '100' })
  const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/voices?${q}`, {
    headers: { 'x-goog-api-key': geminiKey },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`voices ${res.status} ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { voices?: Record<string, unknown>[] }
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return (data.voices ?? [])
    .map((v) => ({
      id: str(v.id) || str(v.name),
      name: str(v.displayName) || str(v.display_name) || str(v.id),
      info: [str(v.accent), str(v.persona), str(v.description)].filter(Boolean).join(' · ').slice(0, 160),
    }))
    .filter((v) => v.id)
}

const isWav = (b: Uint8Array) => b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF'

/** Gemini 3.8 Flash-Lite TTS on the Gemini API (GEMINI_API_KEY from Google AI Studio). */
export async function geminiSpeak(text: string, voice: string, geminiKey: string, fetchFn: typeof fetch = fetch, ms = 15_000): Promise<{ bytes: Uint8Array; mime: string; engine: string }> {
  if (!geminiKey) throw new Error('no GEMINI_API_KEY')
  const model = 'gemini-3.8-flash-lite-tts'
  const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text, speech_metadata: { style: STYLE } }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice } } },
    }),
    signal: AbortSignal.timeout(ms),
  })
  if (!res.ok) throw new Error(`gemini api ${res.status} ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] }
  const b64 = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data
  if (!b64) throw new Error('gemini api empty')
  const raw = new Uint8Array(Buffer.from(b64, 'base64'))
  // Unary 3.8 answers are already WAV; older ones were bare PCM.
  return { bytes: isWav(raw) ? raw : pcmToWav(raw), mime: 'audio/wav', engine: `${model} ${voice}` }
}

