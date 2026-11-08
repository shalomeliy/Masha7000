import { describe, expect, it } from 'vitest'
import { keepHeldRatings, rateCert } from './certRatings'
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
