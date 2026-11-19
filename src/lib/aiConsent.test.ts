import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasAiConsent, onAiConsent, setAiConsent } from './aiConsent'
import { askAssistant, NoAiConsentError } from './assistantApi'

// The tests run without a browser: a small stand-in for this device's storage.
const kept = new Map<string, string>()
beforeEach(() => {
  kept.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('consent to send to an outside AI', () => {
  it('starts off, is kept, and can be taken back', () => {
    expect(hasAiConsent()).toBe(false)
    const seen: boolean[] = []
    const off = onAiConsent((on) => seen.push(on))
    setAiConsent(true)
    expect(hasAiConsent()).toBe(true)
    setAiConsent(false)
    expect(hasAiConsent()).toBe(false)
    off()
    expect(seen).toEqual([true, false])
  })

  it('an older yes (another version of what is sent) asks again', () => {
    localStorage.setItem('shiftsmart.aiConsent', JSON.stringify({ v: 0 }))
    expect(hasAiConsent()).toBe(false)
  })

  it('without it nothing is sent to Claude', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(askAssistant([{ role: 'user', content: 'x' }], {})).rejects.toBeInstanceOf(NoAiConsentError)
    expect(fetch).not.toHaveBeenCalled()
  })
})
