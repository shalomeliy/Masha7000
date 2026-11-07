import { describe, expect, it } from 'vitest'
import { logText, trimEntry, type ClaudeLogEntry } from './claudeLog'

const e: ClaudeLogEntry = {
  id: 'x1',
  at: '2026-11-07T10:05:00.000Z',
  lang: 'he',
  said: ['תעביר את דני לערד 17', 'כן'],
  reason: 'no learned action matches (learned: sick (1 phrasings))',
  understood: 'workers: דני; place: ערד 17; not understood: "תעביר"',
  did: ['propose: דני עובר לערד 17. לאשר?'],
  outcome: 'confirmed',
  learned: '',
}

describe('what went to Claude: the copied text', () => {
  it('has each conversation with why, what was understood, what Claude did and how it ended', () => {
    const t = logText([e])
    expect(t).toContain('1 conversations')
    expect(t).toContain('#1 2026-11-07 10:05 UTC | lang he | confirmed | learned: nothing (not a learnable action)')
    expect(t).toContain('said 1: תעביר את דני לערד 17')
    expect(t).toContain('why not free: no learned action matches')
    expect(t).toContain('understood: workers: דני')
    expect(t).toContain('Claude: propose: דני עובר')
  })

  it('cuts long texts before they are kept', () => {
    const long = trimEntry({ ...e, said: Array(30).fill('א'.repeat(900)), did: Array(30).fill('ב') })
    expect(long.said).toHaveLength(20)
    expect(long.said[0].length).toBe(400)
    expect(long.did).toHaveLength(20)
  })
})
