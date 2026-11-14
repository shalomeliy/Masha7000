import { describe, expect, it, vi } from 'vitest'
import { isStaleDownload, reloadOnceForStaleDownload } from './crashGuardRules'

const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('a screen that could not be downloaded after a new version', () => {
  it('is told apart from other errors, in each browser wording', () => {
    expect(isStaleDownload(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Calendar-1.js'))).toBe(true)
    expect(isStaleDownload(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleDownload(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isStaleDownload(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false)
  })

  it('reloads once, and not again within a minute', () => {
    const store = memory()
    const reload = vi.fn()
    expect(reloadOnceForStaleDownload(1_000_000, store, reload)).toBe(true)
    expect(reloadOnceForStaleDownload(1_030_000, store, reload)).toBe(false)
    expect(reloadOnceForStaleDownload(1_070_000, store, reload)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
