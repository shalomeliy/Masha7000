import { describe, expect, it } from 'vitest'
import { ALL_ON, type FeatureId } from './features'
import { offFeatureSaid } from './featureSpeech'

const off = (...ids: FeatureId[]) => (id: FeatureId) => ({ ...ALL_ON, ...Object.fromEntries(ids.map((x) => [x, false])) })[id]

describe('Shali and turned-off features', () => {
  it('stops a request about a feature that is off', () => {
    expect(offFeatureSaid('תוסיף לעבודה בערד את רכב 678', off('vehicles'))).toBe('vehicles')
    expect(offFeatureSaid('עבודת לילה מחר בבאר שבע', off('nightJobs'))).toBe('nightJobs')
    expect(offFeatureSaid('יוסי בחופש מיום ראשון', off('constraints'))).toBe('constraints')
    expect(offFeatureSaid('שני חשמלאים מחר', off('certs'), ['חשמלאים'])).toBe('certs')
  })
  it('lets everything else through', () => {
    expect(offFeatureSaid('תוסיף לעבודה בערד את רכב 678', off())).toBeNull()
    expect(offFeatureSaid('דני חולה מחר', off('constraints'))).toBeNull()
    expect(offFeatureSaid('עבודה מחר באילת', off('vehicles', 'nightJobs', 'certs'))).toBeNull()
    expect(offFeatureSaid('מחר ברכבת', off('vehicles'))).toBeNull()
  })
})
