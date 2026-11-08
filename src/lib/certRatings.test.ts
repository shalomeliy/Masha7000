import { describe, expect, it } from 'vitest'
import { averageStars, keepHeldRatings, rateCert } from './certRatings'
import type { Worker } from '../types/models'

const dani: Worker = { id: 'd', firstName: 'דני', lastName: 'לוי', certificationIds: ['c1', 'c2'], constraints: [] }

describe('star ratings', () => {
  it('saves only a rating below 5; 5 stars is the same as not rated', () => {
    const three = rateCert(dani, 'c1', 3)
    expect(three.certRatings).toEqual({ c1: 3 })
    expect('certRatings' in rateCert(three, 'c1', 5)).toBe(false)
    expect(rateCert(rateCert(three, 'c2', 1), 'c1', 5).certRatings).toEqual({ c2: 1 })
  })
  it('drops the rating of a certification the worker no longer holds', () => {
    const w = { ...rateCert(rateCert(dani, 'c1', 2), 'c2', 4), certificationIds: ['c2'] }
    expect(keepHeldRatings(w).certRatings).toEqual({ c2: 4 })
    expect('certRatings' in keepHeldRatings({ ...w, certificationIds: [] })).toBe(false)
  })
})

describe('averageStars', () => {
  const base = { id: 'w', firstName: 'a', lastName: 'b', constraints: [] }
  it('is null without certifications', () => {
    expect(averageStars({ ...base, certificationIds: [] })).toBeNull()
  })
  it('averages to one decimal, unrated counting as 5', () => {
    expect(averageStars({ ...base, certificationIds: ['a', 'b', 'c'], certRatings: { a: 2, b: 4 } })).toBe(3.7)
    expect(averageStars({ ...base, certificationIds: ['a'] })).toBe(5)
  })
  it('counts only the given ids', () => {
    expect(averageStars({ ...base, certificationIds: ['a', 'gone'], certRatings: { a: 3 } }, ['a'])).toBe(3)
  })
})

describe('averageStars with unrated (0) certifications', () => {
  const base = { id: 'w', firstName: 'a', lastName: 'b', constraints: [] }
  it('leaves out 0 = not rated, null when all are unrated', () => {
    expect(averageStars({ ...base, certificationIds: ['a', 'b'], certRatings: { a: 0, b: 3 } })).toBe(3)
    expect(averageStars({ ...base, certificationIds: ['a'], certRatings: { a: 0 } })).toBeNull()
  })
})
