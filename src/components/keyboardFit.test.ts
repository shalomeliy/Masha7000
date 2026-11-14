import { describe, expect, it, vi } from 'vitest'
import { fitToKeyboard } from './keyboardFit'

// A fake phone screen: 800px tall, and a keyboard that takes `kb` px off the visible part.
function fakePhone() {
  const listeners: Record<string, () => void> = {}
  const vv = {
    height: 800,
    offsetTop: 0,
    addEventListener: (t: string, l: () => void) => (listeners[t] = l),
    removeEventListener: (t: string) => delete listeners[t],
  }
  const field = { matches: () => true, scrollIntoView: vi.fn() }
  const vars: Record<string, string> = {}
  const sheet = {
    style: {
      marginBottom: '',
      setProperty: (k: string, v: string) => (vars[k] = v),
      removeProperty: (k: string) => delete vars[k],
    },
    contains: (el: unknown) => el === field,
  }
  const win = { innerHeight: 800, visualViewport: vv, document: { activeElement: field } }
  const keyboard = (kb: number, scrolled = 0) => {
    vv.height = 800 - kb
    vv.offsetTop = scrolled
    listeners.resize?.()
  }
  return { sheet, win, vars, field, keyboard, listeners }
}

describe('a sheet with the phone keyboard open', () => {
  it('sits above the keyboard and is no taller than what is left, so its buttons can be reached', () => {
    const p = fakePhone()
    fitToKeyboard(p.sheet as never, p.win as never)
    expect(p.sheet.style.marginBottom).toBe('')
    expect(p.vars['--sheet-vh']).toBe('800px')
    p.keyboard(300)
    expect(p.sheet.style.marginBottom).toBe('300px')
    expect(p.vars['--sheet-vh']).toBe('500px')
    expect(p.field.scrollIntoView).toHaveBeenCalled()
  })

  it('on iPhone, where the page scrolls up under the keyboard, still ends at the keyboard top', () => {
    const p = fakePhone()
    fitToKeyboard(p.sheet as never, p.win as never)
    p.keyboard(300, 120)
    expect(p.sheet.style.marginBottom).toBe('180px')
  })

  it('where the browser already shrinks the page for the keyboard, adds nothing', () => {
    const p = fakePhone()
    fitToKeyboard(p.sheet as never, p.win as never)
    p.win.innerHeight = 500
    p.keyboard(300)
    expect(p.sheet.style.marginBottom).toBe('')
  })

  it('puts everything back when the sheet closes', () => {
    const p = fakePhone()
    const stop = fitToKeyboard(p.sheet as never, p.win as never)
    p.keyboard(300)
    stop()
    expect(p.sheet.style.marginBottom).toBe('')
    expect(p.vars['--sheet-vh']).toBeUndefined()
    expect(Object.keys(p.listeners)).toEqual([])
  })
})
