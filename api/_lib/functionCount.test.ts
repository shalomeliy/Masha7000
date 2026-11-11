import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vercel's Hobby plan builds at most 12 function files. A 13th one failed every deploy on 2026-11-11 (the app
// stayed on an old version). Every .ts under api/ that is not in a folder starting with "_" and is not a test counts.
function functionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('_')) return []
    const p = join(dir, e.name)
    if (e.isDirectory()) return functionFiles(p)
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : []
  })
}

describe('Vercel function count', () => {
  it('stays within the 12 the plan allows', () => {
    expect(functionFiles(join(__dirname, '..')).length).toBeLessThanOrEqual(12)
  })
})
