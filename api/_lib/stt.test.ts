import { describe, expect, it, vi } from 'vitest'
import { readSttRequest, sttKey, sttMonthlyLimit, sttProvider, takeSeconds, transcribe } from './stt.js'
import { kv } from './kv.js'
import type { Env } from './env.js'

function wav(seconds: number, rate = 16_000): Buffer {
  const data = Math.round(seconds * rate) * 2
  const b = Buffer.alloc(44 + data)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(36 + data, 4)
  b.write('WAVEfmt ', 8, 'ascii')
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii')
  b.writeUInt32LE(data, 40)
  return b
}

describe('speech to text (server)', () => {
  it('starts with Google and moves to OpenAI by STT_PROVIDER alone', () => {
    expect(sttProvider({})).toBe('google')
    expect(sttProvider({ STT_PROVIDER: ' OpenAI ' })).toBe('openai')
    expect(sttKey('google', { GOOGLE_TTS_API_KEY: ' g ', OPENAI_API_KEY: 'o' })).toBe('g')
    expect(sttKey('openai', { GOOGLE_TTS_API_KEY: 'g', OPENAI_API_KEY: 'o' })).toBe('o')
  })

  it('takes a 16 kHz mono WAV up to 30 seconds and refuses anything else', () => {
    expect(readSttRequest({ audio: wav(5).toString('base64') })).toMatchObject({ seconds: 5, lang: 'he-IL' })
    expect(readSttRequest({ audio: wav(5).toString('base64'), lang: 'ar-SA' })?.lang).toBe('ar-SA')
    expect(readSttRequest({ audio: wav(5).toString('base64'), lang: 'x; drop' })?.lang).toBe('he-IL')
    expect(readSttRequest({ audio: wav(31).toString('base64') })).toBeNull()
    expect(readSttRequest({ audio: wav(5, 48_000).toString('base64') })).toBeNull()
    expect(readSttRequest({ audio: Buffer.from('not audio at all, just text here....................').toString('base64') })).toBeNull()
    expect(readSttRequest({})).toBeNull()
  })

  it('stops the month at 3,000 seconds by default, counting whole seconds', async () => {
    expect(sttMonthlyLimit({})).toBe(3000)
    let used = 0
    vi.spyOn(kv, 'incrBy').mockImplementation(async (_e, _k, by) => (used += by))
    vi.spyOn(kv, 'expire').mockResolvedValue(undefined as never)
    const e = { STT_MONTHLY_SECONDS: '10' }
    expect(await takeSeconds({} as Env, 4.2, new Date(), e)).toBe(true)
    expect(await takeSeconds({} as Env, 5, new Date(), e)).toBe(true)
    expect(await takeSeconds({} as Env, 0.1, new Date(), e)).toBe(false)
    vi.restoreAllMocks()
  })

  it('sends Google the sound without the WAV header, in Hebrew, and joins the results', async () => {
    let sent: { config: Record<string, unknown>; audio: { content: string } } | null = null
    const google = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ results: [{ alternatives: [{ transcript: 'דוליק חולה' }] }, { alternatives: [{ transcript: 'מחר' }] }] }))
    }) as unknown as typeof fetch
    const w = wav(1)
    expect(await transcribe('google', 'k', w, 'he-IL', google)).toBe('דוליק חולה מחר')
    expect(sent!.config).toEqual({ encoding: 'LINEAR16', sampleRateHertz: 16_000, languageCode: 'he-IL' })
    expect(Buffer.from(sent!.audio.content, 'base64').length).toBe(w.length - 44)
    const silent = (async () => new Response('{}')) as unknown as typeof fetch
    expect(await transcribe('google', 'k', w, 'he-IL', silent)).toBe('')
    const refused = (async () => new Response('nope', { status: 403 })) as unknown as typeof fetch
    await expect(transcribe('google', 'k', w, 'he-IL', refused)).rejects.toThrow('google stt 403')
  })

  it('sends OpenAI the WAV file with gpt-4o-mini-transcribe', async () => {
    let form: FormData | null = null
    const openai = (async (_url: string, init: RequestInit) => {
      form = init.body as FormData
      return new Response(JSON.stringify({ text: ' שלום ' }))
    }) as unknown as typeof fetch
    expect(await transcribe('openai', 'k', wav(1), 'he-IL', openai)).toBe('שלום')
    expect(form!.get('model')).toBe('gpt-4o-mini-transcribe')
    expect(form!.get('language')).toBe('he')
  })
})
