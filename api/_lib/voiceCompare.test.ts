import { describe, expect, it } from 'vitest'
import { addNikud, compareVoice, listVoices, pcmToWav, readCompareRequest } from './voiceCompare.js'

type Call = { url: string; body: Record<string, unknown> }
const fake = (calls: Call[]) =>
  (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    calls.push({ url, body })
    if (url.includes('dicta')) return new Response(JSON.stringify([{ word: 'שלום', options: ['שָׁ|לוֹם'] }, { word: ' ', sep: true }, { word: 'דני', options: [] }]))
    if (url.includes('generativelanguage'))
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from([1, 2, 3, 4]).toString('base64') } }] } }] }))
    return new Response(JSON.stringify({ audioContent: Buffer.from('mp3').toString('base64') }))
  }) as unknown as typeof fetch

describe('voice compare spike (server)', () => {
  it('accepts a short sentence and a known engine only', () => {
    expect(readCompareRequest({ text: ' שלום ', engine: 'gemini', nikud: true })).toEqual({ text: 'שלום', engine: 'gemini', nikud: true, voice: 'Sadaltager' })
    expect(readCompareRequest({ text: 'שלום', engine: 'chirp' })).toEqual({ text: 'שלום', engine: 'chirp', nikud: false, voice: 'Sadaltager' })
    expect(readCompareRequest({ text: 'שלום', engine: 'gemini', voice: 'voice_abc-1' })?.voice).toBe('voice_abc-1')
    expect(readCompareRequest({ text: 'שלום', engine: 'gemini', voice: 'a b<script>' })?.voice).toBe('Sadaltager')
    expect(readCompareRequest({ text: 'שלום', engine: 'eleven' })).toBeNull()
    expect(readCompareRequest({ text: 'א'.repeat(301), engine: 'chirp' })).toBeNull()
    expect(readCompareRequest(null)).toBeNull()
  })

  it('adds niqqud from the first Nakdan option, dropping prefix marks, keeping separators and unknown words', async () => {
    expect(await addNikud('שלום דני', fake([]))).toBe('שָׁלוֹם דני')
  })

  it('reads the niqqud text with Chirp when asked', async () => {
    const calls: Call[] = []
    const r = await compareVoice({ text: 'שלום דני', engine: 'chirp', nikud: true, voice: 'Sadaltager' }, { tts: 'k', gemini: '' }, fake(calls))
    expect(r.said).toBe('שָׁלוֹם דני')
    expect(r.engine).toBe('chirp3-hd')
    expect((calls[1].body.input as { text: string }).text).toBe('שָׁלוֹם דני')
  })

  it('sends Gemini only the words (style apart, so it is not read aloud) and keeps a WAV answer as it is', async () => {
    const calls: Call[] = []
    const r = await compareVoice({ text: 'שלום', engine: 'gemini', nikud: false, voice: 'v1' }, { tts: 'k', gemini: 'g' }, fake(calls))
    const part = (calls[0].body.contents as { parts: { text: string; speech_metadata: unknown }[] }[])[0].parts[0]
    expect(part.text).toBe('שלום')
    expect(part.speech_metadata).toBeTruthy()
    expect(calls[0].body.generationConfig).toMatchObject({ speechConfig: { voiceConfig: { voice: 'v1' } } })
    expect(r.mime).toBe('audio/wav')
    expect(Buffer.from(r.audio, 'base64').subarray(0, 4).toString()).toBe('RIFF')
    await expect(compareVoice({ text: 'שלום', engine: 'gemini', nikud: false, voice: 'v1' }, { tts: 'k', gemini: '' }, fake([]))).rejects.toThrow('GEMINI')
  })

  it('lists Hebrew male voices from the Voice Library', async () => {
    let asked = ''
    const f = (async (url: string) => {
      asked = url
      return new Response(JSON.stringify({ voices: [{ id: 'voice_1', displayName: 'Avi', accent: 'Israeli' }, { foo: 1 }] }))
    }) as unknown as typeof fetch
    expect(await listVoices('g', f)).toEqual([{ id: 'voice_1', name: 'Avi', info: 'Israeli' }])
    expect(asked).toContain('language_code=he-IL')
    expect(asked).toContain('gender=male')
  })

  it('makes a valid WAV header', () => {
    const w = pcmToWav(new Uint8Array(10), 24_000)
    const v = new DataView(w.buffer)
    expect(w.length).toBe(54)
    expect(v.getUint32(24, true)).toBe(24_000)
    expect(v.getUint32(40, true)).toBe(10)
  })
})
