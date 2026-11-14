import { describe, expect, it } from 'vitest'
import { splitSentences } from './cloudVoice'

describe('cloud voice sentences', () => {
  it('cuts a reply into sentences and glues a very short one to the next', () => {
    expect(splitSentences('אשר. הבנתי: עבודה חדשה באילת ביום שלישי. לאשר, או שיש עוד תיקון?')).toEqual([
      'אשר. הבנתי: עבודה חדשה באילת ביום שלישי.',
      'לאשר, או שיש עוד תיקון?',
    ])
  })

  it('keeps every piece under 280 characters, cut at a comma or a space', () => {
    const long = Array.from({ length: 60 }, (_, i) => `מילה${i},`).join(' ')
    const pieces = splitSentences(long)
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.every((p) => p.length <= 280)).toBe(true)
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(long)
  })

  it('returns nothing for empty text', () => {
    expect(splitSentences('  ')).toEqual([])
  })
})
