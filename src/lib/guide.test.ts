import { describe, expect, it } from 'vitest'
import { ALL_ON, FEATURE_IDS } from './features'
import { chapters, visibleChapters } from './guide'

describe('guide', () => {
  it('every feature has a chapter', () => {
    for (const id of FEATURE_IDS) expect(chapters().some((c) => c.feature === id), id).toBe(true)
  })
  it('shows only the chapters of features that are on, and no voice examples without Shali', () => {
    const flags = { ...ALL_ON, vehicles: false, shali: false }
    const shown = visibleChapters((id) => flags[id])
    expect(shown.some((c) => c.feature === 'vehicles')).toBe(false)
    expect(shown.every((c) => !c.say)).toBe(true)
  })
})
