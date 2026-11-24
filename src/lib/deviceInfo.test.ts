import { describe, expect, it } from 'vitest'
import { detectDevice, deviceFromUserAgent } from './deviceInfo'

describe('device guess for fault reports', () => {
  it('reads Android, iPhone, Windows and Mac from the user agent', () => {
    expect(deviceFromUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S911B Build/TP1A) AppleWebKit')).toEqual({ model: 'SM-S911B', os: 'Android', osVersion: '13' })
    // Chrome's reduced user agent hides the model.
    expect(deviceFromUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit')).toEqual({ model: '', os: 'Android', osVersion: '10' })
    expect(deviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X)')).toEqual({ model: 'iPhone', os: 'iOS', osVersion: '17.4.1' })
    expect(deviceFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)').os).toBe('Windows')
    expect(deviceFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)').os).toBe('macOS')
    expect(deviceFromUserAgent('')).toEqual({ model: '', os: '', osVersion: '' })
  })

  it("takes the real model and version from Chrome's hints", async () => {
    const nav = {
      userAgent: 'Mozilla/5.0 (Linux; Android 10; K)',
      userAgentData: { getHighEntropyValues: async () => ({ model: 'SM-S918B', platform: 'Android', platformVersion: '14.0.0' }) },
    } as unknown as Navigator
    expect(await detectDevice(nav)).toEqual({ model: 'SM-S918B', os: 'Android', osVersion: '14' })
  })

  it('keeps the user agent guess when the hints fail', async () => {
    const nav = { userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7)', userAgentData: { getHighEntropyValues: async () => Promise.reject(new Error('no')) } } as unknown as Navigator
    expect(await detectDevice(nav)).toEqual({ model: 'Pixel 7', os: 'Android', osVersion: '13' })
  })
})
