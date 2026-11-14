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

  it('cuts a long first sentence at its first comma, so the first words come fast', () => {
    expect(splitSentences('הבנתי: עבודה חדשה באילת, אתר 123, ביום שלישי 18 בנובמבר, משמרת לילה. לאשר?')).toEqual([
      'הבנתי: עבודה חדשה באילת,',
      'אתר 123, ביום שלישי 18 בנובמבר, משמרת לילה.',
      'לאשר?',
    ])
  })

  it('returns nothing for empty text', () => {
    expect(splitSentences('  ')).toEqual([])
  })
})
