import { describe, expect, it } from 'vitest'
import { WORKER_PALETTE, workerColors } from './workerColor'

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `worker-${i}` }))

describe('workerColors', () => {
  it('gives every worker a palette color, the same one every time', () => {
    const a = workerColors(ids(5))
    const b = workerColors(ids(5))
    expect([...a.values()].every((c) => WORKER_PALETTE.includes(c))).toBe(true)
    expect(a).toEqual(b)
  })

  it('gives different workers different colors while there are enough colors', () => {
    const colors = workerColors(ids(WORKER_PALETTE.length))
    expect(new Set(colors.values()).size).toBe(WORKER_PALETTE.length)
  })

  it('keeps everyone’s color when a worker is added at the end of the list', () => {
    const before = workerColors(ids(8))
    const after = workerColors([...ids(8), { id: 'new-worker' }])
    for (const [id, color] of before) expect(after.get(id)).toBe(color)
  })

  it('still colors everyone when there are more workers than colors', () => {
    expect(workerColors(ids(40)).size).toBe(40)
  })
})
