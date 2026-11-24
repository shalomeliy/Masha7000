import { afterEach, describe, expect, it, vi } from 'vitest'
import { isWhatsapp, loadApplicant, sendAccessRequest } from './accessRequest'

afterEach(() => vi.unstubAllGlobals())

describe('access request', () => {
  it('takes an Israeli mobile for WhatsApp', () => {
    expect(isWhatsapp('050-123 4567')).toBe(true)
    expect(isWhatsapp('+972501234567')).toBe(true)
    expect(isWhatsapp('031234567')).toBe(false)
    expect(isWhatsapp('05012')).toBe(false)
  })

  it('never sends an email: the server knows it from the Google sign-in', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{"ok":true}')))
    vi.stubGlobal('fetch', fetchMock)
    await sendAccessRequest('חשמל דרום', '0501234567')
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body).toEqual({ businessName: 'חשמל דרום', whatsapp: '0501234567' })
  })

  it('reads a server refusal in plain words, and no server as "sign in first"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"reason":"whatsapp"}', { status: 400 }))))
    await expect(sendAccessRequest('x', '1')).rejects.toThrow('05X')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    expect(await loadApplicant()).toEqual({ email: null, sent: false })
  })
})
