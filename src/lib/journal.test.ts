import { describe, expect, it } from 'vitest'
import { byDay, durationOf, endsNextDay, hoursText, journalError, newestFirst, spokenTimes } from './journal'
import type { JournalEntry } from '../types/models'

const e = (over: Partial<JournalEntry> = {}): JournalEntry => ({ id: 'a', date: '2026-11-20', start: '08:00', end: '12:30', text: '', ...over })

describe('journal', () => {
  it('needs a date, a start and an end; the text may be empty', () => {
    expect(journalError(e())).toBeNull()
    expect(journalError(e({ date: '' }))).toBe('צריך לבחור תאריך')
    expect(journalError(e({ start: '' }))).toBe('צריך למלא שעת התחלה')
    expect(journalError(e({ end: '' }))).toBe('צריך למלא שעת סיום')
    expect(journalError(e({ end: '08:00' }))).toBe('שעת סיום לא יכולה להיות כמו שעת התחלה')
  })

  it('an end earlier than the start ended the next day', () => {
    expect(endsNextDay(e({ start: '22:00', end: '02:15' }))).toBe(true)
    expect(durationOf(e({ start: '22:00', end: '02:15' }))).toBe(255)
    expect(durationOf(e())).toBe(270)
    expect(hoursText(270)).toBe('4:30')
  })

  it('lists newest first, grouped by day with the day total', () => {
    const list = [e({ id: '1', date: '2026-11-19' }), e({ id: '2', start: '13:00', end: '14:00' }), e({ id: '3' })]
    expect(newestFirst(list).map((x) => x.id)).toEqual(['2', '3', '1'])
    const days = byDay(list)
    expect(days.map((d) => [d.date, d.total])).toEqual([['2026-11-20', 330], ['2026-11-19', 270]])
  })

})

describe('times said while dictating', () => {
  it('takes "שעת התחלה" and "שעת סיום" into their fields and out of the text', () => {
    expect(spokenTimes('שעת התחלה 08:30 וגם שעת סיום 12:00 בדקתי את הגנרטור')).toEqual({ start: '08:30', end: '12:00', text: 'בדקתי את הגנרטור' })
    expect(spokenTimes('בדקתי את הגנרטור שעת התחלה 8 30 שעת סיום 1430')).toEqual({ start: '08:30', end: '14:30', text: 'בדקתי את הגנרטור' })
    expect(spokenTimes('סיור באתר, שעת סיום 17.15')).toEqual({ end: '17:15', text: 'סיור באתר,' })
  })

  it('reads hours said in words, with half, quarter and the time of day', () => {
    expect(spokenTimes('שעת התחלה שמונה וחצי שעת סיום ארבע בערב ישיבה')).toEqual({ start: '08:30', end: '16:00', text: 'ישיבה' })
    expect(spokenTimes('שעת התחלה עשר בלילה ושעת סיום שתיים')).toEqual({ start: '22:00', end: '02:00', text: '' })
  })

  it('leaves the text alone when no time follows', () => {
    expect(spokenTimes('דיברנו על סיום הפרויקט')).toEqual({ text: 'דיברנו על סיום הפרויקט' })
    expect(spokenTimes('שעת סיום 25:00')).toEqual({ text: 'שעת סיום 25:00' })
  })
})
