import { describe, expect, it } from 'vitest'
import { addNikud, compareVoice, pcmToWav, readCompareRequest } from './voiceCompare.js'

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
    expect(readCompareRequest({ text: ' שלום ', engine: 'gemini', nikud: true })).toEqual({ text: 'שלום', engine: 'gemini', nikud: true })
    expect(readCompareRequest({ text: 'שלום', engine: 'chirp' })).toEqual({ text: 'שלום', engine: 'chirp', nikud: false })
    expect(readCompareRequest({ text: 'שלום', engine: 'eleven' })).toBeNull()
    expect(readCompareRequest({ text: 'א'.repeat(301), engine: 'chirp' })).toBeNull()
    expect(readCompareRequest(null)).toBeNull()
  })

  it('adds niqqud from the first Nakdan option, dropping prefix marks, keeping separators and unknown words', async () => {
    expect(await addNikud('שלום דני', fake([]))).toBe('שָׁלוֹם דני')
  })

  it('reads the niqqud text with Chirp when asked', async () => {
    const calls: Call[] = []
    const r = await compareVoice({ text: 'שלום דני', engine: 'chirp', nikud: true }, { tts: 'k', gemini: '' }, fake(calls))
    expect(r.said).toBe('שָׁלוֹם דני')
    expect(r.engine).toBe('chirp3-hd')
    expect((calls[1].body.input as { text: string }).text).toBe('שָׁלוֹם דני')
  })

  it('uses Gemini on the Cloud TTS key without a Gemini key, and the Gemini API with one (as WAV)', async () => {
    const calls: Call[] = []
    const cloud = await compareVoice({ text: 'שלום', engine: 'gemini', nikud: false }, { tts: 'k', gemini: '' }, fake(calls))
    expect(cloud.engine).toBe('gemini-3.1-flash-tts-preview')
    expect(calls[0].body.voice).toMatchObject({ languageCode: 'he-IL', modelName: 'gemini-3.1-flash-tts-preview' })
    const api = await compareVoice({ text: 'שלום', engine: 'gemini', nikud: false }, { tts: 'k', gemini: 'g' }, fake(calls))
    expect(api.mime).toBe('audio/wav')
    expect(Buffer.from(api.audio, 'base64').subarray(0, 4).toString()).toBe('RIFF')
  })

  it('makes a valid WAV header', () => {
    const w = pcmToWav(new Uint8Array(10), 24_000)
    const v = new DataView(w.buffer)
    expect(w.length).toBe(54)
    expect(v.getUint32(24, true)).toBe(24_000)
    expect(v.getUint32(40, true)).toBe(10)
  })
})
