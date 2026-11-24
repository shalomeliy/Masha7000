import { describe, expect, it } from 'vitest'
import { geminiSpeak, pcmToWav } from './gemini.js'

describe("Shali's Gemini voice", () => {
  it('makes a valid WAV header', () => {
    const w = pcmToWav(new Uint8Array(10), 24_000)
    const v = new DataView(w.buffer)
    expect(w.length).toBe(54)
    expect(v.getUint32(24, true)).toBe(24_000)
    expect(v.getUint32(40, true)).toBe(10)
  })

  it('sends only the words (style apart, so it is not read aloud) and keeps a WAV answer as it is', async () => {
    let body: Record<string, unknown> = {}
    const f = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>
      const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(20)]).toString('base64')
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: wav } }] } }] }))
    }) as unknown as typeof fetch
    const r = await geminiSpeak('שלום', 'Sadaltager', 'g', f)
    const part = (body.contents as { parts: { text: string; speech_metadata: unknown }[] }[])[0].parts[0]
    expect(part.text).toBe('שלום')
    expect(part.speech_metadata).toBeTruthy()
    expect(body.generationConfig).toMatchObject({ speechConfig: { voiceConfig: { voice: 'Sadaltager' } } })
    expect(r.mime).toBe('audio/wav')
    expect(Buffer.from(r.bytes).subarray(0, 4).toString()).toBe('RIFF')
  })
})
