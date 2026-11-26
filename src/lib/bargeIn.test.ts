import { describe, expect, it } from 'vitest'
import { canBargeIn, detector } from './bargeIn'

const feed = (levels: number[]) => {
  const heard = detector()
  return levels.findIndex((l) => heard(l))
}

describe('barge-in detector', () => {
  it("does not count Shali's own voice, as the mic hears it at the start", () => {
    // Shali's echo at 0.05 all along: never the manager.
    expect(feed(Array(60).fill(0.05))).toBe(-1)
  })

  it('hears the manager talking clearly over Shali, after 300 ms of it', () => {
    const levels = [...Array(6).fill(0.04), ...Array(10).fill(0.02), ...Array(10).fill(0.3)]
    expect(feed(levels)).toBe(16 + 5)
  })

  it('a short click or cough does not cut Shali off', () => {
    const levels = [...Array(6).fill(0.02), 0.5, 0.5, 0.02, 0.5, 0.5, 0.5, 0.02, ...Array(20).fill(0.02)]
    expect(feed(levels)).toBe(-1)
  })

  it('in a quiet room, speech must still be at least a little loud', () => {
    const levels = [...Array(6).fill(0.001), ...Array(20).fill(0.02)]
    expect(feed(levels)).toBe(-1)
  })

  it('is never on an iPhone', () => {
    expect(canBargeIn(true)).toBe(false)
  })
})
