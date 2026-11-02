import { beforeEach, describe, expect, it, vi } from 'vitest'

// A fake browser history: entries, a position, and popstate fired after go().
function fakeWindow() {
  let entries = 1
  let at = 0
  const listeners: (() => void)[] = []
  const win = {
    history: {
      pushState: () => {
        entries = at + 2
        at++
      },
      go: (n: number) => {
        at = Math.max(0, at + n)
        listeners.forEach((l) => l())
      },
    },
    addEventListener: (_: string, l: () => void) => listeners.push(l),
  }
  const back = () => win.history.go(-1)
  return { win, back, depth: () => at, size: () => entries }
}

let w: ReturnType<typeof fakeWindow>
let holdBack: typeof import('./backStack').holdBack
const flush = () => new Promise((r) => setTimeout(r))

beforeEach(async () => {
  vi.resetModules()
  w = fakeWindow()
  vi.stubGlobal('window', w.win)
  holdBack = (await import('./backStack')).holdBack
})

describe('holdBack', () => {
  it('Back closes only the top sheet', () => {
    const closed: string[] = []
    holdBack(() => (closed.push('a'), false))
    holdBack(() => (closed.push('b'), false))
    expect(w.depth()).toBe(2)
    w.back()
    expect(closed).toEqual(['b'])
    w.back()
    expect(closed).toEqual(['b', 'a'])
  })

  it('a sheet closed by Cancel gives its entry back without closing the one under it', async () => {
    const closed: string[] = []
    holdBack(() => (closed.push('a'), false))
    const releaseB = holdBack(() => (closed.push('b'), false))
    releaseB()
    await flush()
    expect(w.depth()).toBe(1)
    expect(closed).toEqual([])
    w.back()
    expect(closed).toEqual(['a'])
  })

  it('a locked sheet stays open on Back and keeps its entry', () => {
    let closes = 0
    holdBack(() => (closes++, true))
    w.back()
    expect(closes).toBe(1)
    expect(w.depth()).toBe(1)
  })

  it('closing one sheet while opening another reuses the entry', async () => {
    const closed: string[] = []
    const releaseA = holdBack(() => (closed.push('a'), false))
    releaseA()
    holdBack(() => (closed.push('b'), false))
    await flush()
    expect(w.depth()).toBe(1)
    w.back()
    expect(closed).toEqual(['b'])
  })

  it('two sheets closing together step back once for both', async () => {
    const ra = holdBack(() => false)
    const rb = holdBack(() => false)
    rb()
    ra()
    await flush()
    expect(w.depth()).toBe(0)
  })
})
