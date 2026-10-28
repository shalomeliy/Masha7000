import { describe, expect, it } from 'vitest'
import { dateError, isRealDate, todayIso } from './dates'

describe('isRealDate', () => {
  it('accepts dates that exist, including 29.2 in a leap year', () => {
    expect(isRealDate('2026-10-28')).toBe(true)
    expect(isRealDate('2028-02-29')).toBe(true)
  })
  it('rejects dates that do not exist or are malformed', () => {
    expect(isRealDate('2026-02-29')).toBe(false)
    expect(isRealDate('2026-02-31')).toBe(false)
    expect(isRealDate('2026-13-01')).toBe(false)
    expect(isRealDate('28/10/2026')).toBe(false)
    expect(isRealDate('')).toBe(false)
  })
})

describe('dateError', () => {
  it('allows empty unless required', () => {
    expect(dateError('')).toBeNull()
    expect(dateError('', { required: true })).toBe('צריך לבחור תאריך')
  })
  it('explains a date missing from the calendar or out of range', () => {
    expect(dateError('2026-02-30')).toBe('התאריך הזה לא קיים ביומן')
    expect(dateError('2030-01-01', { max: '2026-10-28' })).toBe('התאריך צריך להיות עד 28.10.2026')
    expect(dateError('1899-12-31', { min: '1900-01-01' })).toBe('התאריך צריך להיות מ-01.01.1900 והלאה')
    expect(dateError('1980-05-05', { min: '1900-01-01', max: '2026-10-28' })).toBeNull()
  })
})

describe('todayIso', () => {
  it('uses the local date', () => {
    expect(todayIso(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03')
  })
})
