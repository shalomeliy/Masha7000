import { describe, expect, it, vi } from 'vitest'
import { CACHE_MAX_CHARS, cacheTarget, CLOUD_VOICES as SERVER_VOICES, keepVoice, readCachedVoice, readTtsRequest, speakBest, synthesize, takeChars, ttsMonthlyLimit, voiceEngine } from './tts.js'
import { CLOUD_VOICES as APP_VOICES } from '../../src/lib/cloudVoice.js'
import { kv } from './kv.js'
import type { Env } from './env.js'

describe('cloud voice (server)', () => {
  it('accepts a sentence with a known voice; else the default voice and rate 1; refuses empty or too long', () => {
    expect(readTtsRequest({ text: ' שלום ', voice: 'Charon', rate: 1.25 })).toEqual({ text: 'שלום', voice: 'Charon', rate: 1.25 })
    expect(readTtsRequest({ text: 'שלום', voice: 'Kore', rate: 9 })).toEqual({ text: 'שלום', voice: 'Sadaltager', rate: 1 })
    expect(readTtsRequest({ text: '' })).toBeNull()
    expect(readTtsRequest({ text: 'א'.repeat(601) })).toBeNull()
    expect(readTtsRequest(null)).toBeNull()
  })

  it('offers the same voices as the app', () => {
    expect([...SERVER_VOICES]).toEqual([...APP_VOICES])
  })

  it('stops the month at 900,000 characters by default', async () => {
    expect(ttsMonthlyLimit({})).toBe(900_000)
    expect(ttsMonthlyLimit({ TTS_MONTHLY_CHARS: '1000' })).toBe(1000)
    let used = 0
    vi.spyOn(kv, 'incrBy').mockImplementation(async (_e, _k, by) => (used += by))
    vi.spyOn(kv, 'expire').mockResolvedValue(undefined as never)
    const env = {} as Env
    expect(await takeChars(env, 600, new Date(), { TTS_MONTHLY_CHARS: '1000' })).toBe(true)
    expect(await takeChars(env, 400, new Date(), { TTS_MONTHLY_CHARS: '1000' })).toBe(true)
    expect(await takeChars(env, 1, new Date(), { TTS_MONTHLY_CHARS: '1000' })).toBe(false)
    vi.restoreAllMocks()
  })

  it('asks Google for the Hebrew Chirp 3 HD voice as MP3 and throws on a refusal', async () => {
    const calls: { url: string; body: unknown; key: string | null }[] = []
    const ok = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), key: new Headers(init.headers).get('X-Goog-Api-Key') })
      return new Response(JSON.stringify({ audioContent: Buffer.from('mp3').toString('base64') }))
    }) as unknown as typeof fetch
    const bytes = await synthesize('k', { text: 'שלום', voice: 'Charon', rate: 1 }, ok)
    expect(Buffer.from(bytes).toString()).toBe('mp3')
    expect(calls[0].key).toBe('k')
    expect(calls[0].body).toMatchObject({ voice: { languageCode: 'he-IL', name: 'he-IL-Chirp3-HD-Charon' }, audioConfig: { audioEncoding: 'MP3' } })
    const no = (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch
    await expect(synthesize('k', { text: 'x', voice: 'Charon', rate: 1 }, no)).rejects.toThrow('429')
  })
})

describe('Shali speaks with Gemini, Chirp when it cannot', () => {
  const req = { text: 'שלום', voice: 'Charon' as const, rate: 1 }
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(20)]).toString('base64')
  const fake = (gemini: 'ok' | 'fail') => {
    const seen: string[] = []
    const f = (async (url: string, init: RequestInit) => {
      seen.push(url)
      if (url.includes('generativelanguage')) {
        if (gemini === 'fail') return new Response('quota', { status: 429 })
        const text = (JSON.parse(String(init.body)) as { contents: { parts: { text: string }[] }[] }).contents[0].parts[0].text
        seen.push(`said:${text}`)
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: wav } }] } }] }))
      }
      return new Response(JSON.stringify({ audioContent: Buffer.from('mp3').toString('base64') }))
    }) as unknown as typeof fetch
    return { f, seen }
  }
  const g = { geminiKey: 'g', geminiVoice: 'Sadaltager' }

  it('is on only with a Gemini key, and TTS_ENGINE=chirp turns it off', () => {
    expect(voiceEngine({})).toBeNull()
    expect(voiceEngine({ GEMINI_API_KEY: 'g' })).toEqual(g)
    expect(voiceEngine({ GEMINI_API_KEY: 'g', GEMINI_VOICE: 'voice_x' })?.geminiVoice).toBe('voice_x')
    expect(voiceEngine({ GEMINI_API_KEY: 'g', TTS_ENGINE: 'chirp' })).toBeNull()
  })

  it('reads the plain text with Gemini as WAV, without asking Dicta for niqqud (owner, 2026-11-23)', async () => {
    const { f, seen } = fake('ok')
    const r = await speakBest('k', req, g, f)
    expect(r).toMatchObject({ engine: 'gemini', type: 'audio/wav' })
    expect(seen).toContain('said:שלום')
    expect(seen.some((u) => u.includes('dicta'))).toBe(false)
  })

  it('falls back to Chirp (MP3) when Gemini refuses, and uses Chirp alone without a Gemini key', async () => {
    expect(await speakBest('k', req, g, fake('fail').f)).toMatchObject({ engine: 'chirp', type: 'audio/mpeg' })
    const { f, seen } = fake('ok')
    expect((await speakBest('k', req, null, f)).engine).toBe('chirp')
    expect(seen.some((u) => u.includes('dicta') || u.includes('generativelanguage'))).toBe(false)
  })
})

describe('a sentence said before is not paid for again', () => {
  const env = { sessionKey: Buffer.alloc(32, 7).toString('base64') } as Env
  const req = { text: 'רגע, בודק.', voice: 'Charon' as const, rate: 1 }
  const audio = { bytes: new Uint8Array([82, 73, 70, 70, 1, 2]), type: 'audio/wav' }

  it('keeps the audio sealed and gives it back for the same engine, voice and text only', async () => {
    const store = new Map<string, string>()
    vi.spyOn(kv, 'get').mockImplementation(async (_e, k) => store.get(k) ?? null)
    vi.spyOn(kv, 'set').mockImplementation(async (_e, k, v) => void store.set(k, v) as never)
    const expire = vi.spyOn(kv, 'expire').mockResolvedValue(undefined as never)
    const target = cacheTarget(req, { geminiVoice: 'Sadaltager' })
    expect(await readCachedVoice(env, req, target)).toBeNull()
    await keepVoice(env, req, target, { ...audio, engine: 'gemini' })
    expect([...store.values()][0]).not.toContain('רגע')
    const back = await readCachedVoice(env, req, target)
    expect(back?.type).toBe('audio/wav')
    expect([...(back?.bytes ?? [])]).toEqual([...audio.bytes])
    expect(expire).toHaveBeenCalledWith(env, expect.stringMatching(/^tts-cache:/), 30 * 86_400)
    expect(await readCachedVoice(env, req, cacheTarget(req, { geminiVoice: 'Charon' }))).toBeNull()
    expect(await readCachedVoice(env, { ...req, text: 'אחר' }, target)).toBeNull()
    vi.restoreAllMocks()
  })

  it('does not keep a Chirp fallback when Gemini should speak, nor long sentences', async () => {
    const set = vi.spyOn(kv, 'set').mockResolvedValue(undefined as never)
    const target = cacheTarget(req, { geminiVoice: 'Sadaltager' })
    await keepVoice(env, req, target, { ...audio, engine: 'chirp' })
    await keepVoice(env, { ...req, text: 'א'.repeat(CACHE_MAX_CHARS + 1) }, target, { ...audio, engine: 'gemini' })
    expect(set).not.toHaveBeenCalled()
    await keepVoice(env, req, cacheTarget(req, null), { ...audio, engine: 'chirp' })
    expect(set).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('a broken store never stops Shali from speaking', async () => {
    vi.spyOn(kv, 'get').mockRejectedValue(new Error('down'))
    expect(await readCachedVoice(env, req, 'x')).toBeNull()
    vi.restoreAllMocks()
  })
})
