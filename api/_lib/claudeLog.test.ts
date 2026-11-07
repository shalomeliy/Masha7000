import { describe, expect, it } from 'vitest'
import { LOG_MAX, logEntry, tokenMatches, withEntry, type LogEntry } from './claudeLog.js'

const entry = (id: string, over: Partial<LogEntry> = {}): LogEntry => ({
  id,
  at: '2026-11-07T10:00:00.000Z',
  lang: 'he',
  said: ['יוסי חולה מאוד'],
  reason: 'sick: words not learned for sickness: "מאוד"',
  understood: 'workers: יוסי',
  did: [],
  outcome: 'pending',
  learned: '',
  ...over,
})

describe('what went to Claude: the server log', () => {
  it('accepts an entry cut to size, and refuses what is not one', () => {
    const e = logEntry({ ...entry('abcd-1234'), said: ['א'.repeat(1000), 5], outcome: 'weird', extra: 'x' })!
    expect(e.said).toEqual(['א'.repeat(400)])
    expect(e.outcome).toBe('pending')
    expect(e).not.toHaveProperty('extra')
    expect(logEntry({ ...entry('bad id!') })).toBeNull()
    expect(logEntry({ ...entry('abcd'), at: 'not a date' })).toBeNull()
    expect(logEntry('text')).toBeNull()
  })

  it('updates an entry by its id and keeps only the newest', () => {
    const list = withEntry([entry('aaaa'), entry('bbbb')], entry('aaaa', { outcome: 'confirmed', learned: 'sick' }))
    expect(list.map((e) => [e.id, e.outcome])).toEqual([['aaaa', 'confirmed'], ['bbbb', 'pending']])
    let long: LogEntry[] = []
    for (let i = 0; i < LOG_MAX + 5; i++) long = withEntry(long, entry(`id-${i}`))
    expect(long).toHaveLength(LOG_MAX)
    expect(long[0].id).toBe('id-5')
  })

  it('opens to a development key only when it is set, long enough, and the same', () => {
    const token = 'k'.repeat(40)
    const req = (auth?: string) => new Request('https://x/api/claude-log', { headers: auth ? { Authorization: auth } : {} })
    expect(tokenMatches(req(`Bearer ${token}`), token)).toBe(true)
    expect(tokenMatches(req(`Bearer ${token}x`), token)).toBe(false)
    expect(tokenMatches(req(), token)).toBe(false)
    expect(tokenMatches(req('Bearer short'), 'short')).toBe(false)
    expect(tokenMatches(req('Bearer '), '')).toBe(false)
  })
})
