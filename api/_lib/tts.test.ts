import { describe, expect, it, vi } from 'vitest'
import { CLOUD_VOICES as SERVER_VOICES, readTtsRequest, synthesize, takeChars, ttsMonthlyLimit } from './tts.js'
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
