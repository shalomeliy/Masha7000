import { describe, expect, it } from 'vitest'
import { stripQuery } from './monitoring'

describe('monitoring privacy', () => {
  it('drops the form code and token from addresses sent to Sentry', () => {
    expect(stripQuery('https://masha7000.vercel.app/c?c=abc&t=xyz#top')).toBe('https://masha7000.vercel.app/c')
    expect(stripQuery('/join?c=abc')).toBe('/join')
    expect(stripQuery('/calendar')).toBe('/calendar')
    expect(stripQuery(42)).toBe(42)
    expect(stripQuery('https://masha7000.vercel.app/join/AbC123xyz_-9')).toBe('https://masha7000.vercel.app/join/:code')
    expect(stripQuery('/constraints/AbC123xyz?x=1')).toBe('/constraints/:code')
  })
})
