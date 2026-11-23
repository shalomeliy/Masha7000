// Shali's Gemini voice (the owner's pick by ear, 2026-11-23, after a voice-compare spike): Gemini 3.8
// Flash-Lite TTS, voice Sadaltager, reading the plain text. The spike also tried Chirp 3 HD and Dicta's
// niqqud; with billing on, the owner heard plain Gemini as best, so niqqud was dropped and the spike
// removed. The key is GEMINI_API_KEY from Google AI Studio (project "Gemini API", prepaid).

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
// style: Google's own advice is to pick a regional voice from its Voice Library.
const STYLE = 'calm, friendly, professional; casual everyday Israeli speech'

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

