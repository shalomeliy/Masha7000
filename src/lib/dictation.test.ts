import { describe, expect, it } from 'vitest'
import { joinTranscripts } from './dictation'

describe('joinTranscripts', () => {
  it('joins separate pieces with spaces (desktop Chrome)', () => {
    expect(joinTranscripts(['החלפת', ' ציוד', ' קצה'])).toBe('החלפת ציוד קצה')
  })

  it('keeps only the latest of cumulative pieces (Android Chrome)', () => {
    expect(joinTranscripts(['החלפת', 'החלפת ציוד', 'החלפת ציוד קצה', 'החלפת ציוד קצה'])).toBe('החלפת ציוד קצה')
  })

  it('does not swallow a word that only starts like the text so far', () => {
    expect(joinTranscripts(['ציוד', 'ציודים'])).toBe('ציוד ציודים')
  })

  it('skips empty pieces', () => {
    expect(joinTranscripts(['', ' שלום ', '  '])).toBe('שלום')
  })
})
