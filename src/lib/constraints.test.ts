import { describe, expect, it } from 'vitest'
import { blockingConstraint, constraintError, constraintText, isOver, normalizeConstraint, parseReply, requestText } from './constraints'
import type { Constraint, ShiftRecord } from '../types/models'

const c = (over: Partial<Constraint>): Constraint => ({ id: 'c', when: 'dates', ...over })
const shift = (date: string, over: Partial<ShiftRecord> = {}): ShiftRecord => ({ id: 's', date, location: '', jobDescription: '', crew: [], staffing: [], ...over })

describe('constraints', () => {
  it('upgrades the old single-date shape', () => {
    expect(normalizeConstraint({ id: 'x', date: '2026-11-01', reason: ' חתונה ' } as never)).toEqual({
      id: 'x',
      when: 'dates',
      from: '2026-11-01',
      to: '2026-11-01',
      weekdays: undefined,
      nightsOnly: undefined,
      note: 'חתונה',
    })
    expect(normalizeConstraint({ id: 'y', when: 'always' }).nightsOnly).toBe(true)
  })

  it('writes each kind in plain Hebrew', () => {
    expect(constraintText(c({ from: '2026-11-01', to: '2026-11-05' }))).toBe('לא זמין 1.11 עד 5.11')
    expect(constraintText(c({ from: '2026-11-01', to: '2026-11-01' }))).toBe('לא זמין ב-1.11')
    expect(constraintText(c({ when: 'weekdays', weekdays: [5] }))).toBe('לא זמין ביום שישי')
    expect(constraintText(c({ when: 'weekdays', weekdays: [4, 2], nightsOnly: true }))).toBe('בלי לילות בימי שלישי וחמישי')
    expect(constraintText(c({ when: 'always', nightsOnly: true }))).toBe('בלי לילות בכלל')
  })

  it('checks the input', () => {
    expect(constraintError(c({ from: '', to: '' }))).toMatch(/תאריך ההתחלה/)
    expect(constraintError(c({ from: '2026-11-05', to: '2026-11-01' }))).toMatch(/תאריך הסיום/)
    expect(constraintError(c({ when: 'weekdays', weekdays: [] }))).toBe('צריך לסמן לפחות יום אחד בשבוע')
    expect(constraintError(c({ from: '2026-11-01', to: '2026-11-01' }))).toBeNull()
  })

  it('an urgent shift is blocked on every day until its end date', () => {
    const w = { constraints: [c({ from: '2026-11-03', to: '2026-11-03' })] }
    expect(blockingConstraint(w, shift('2026-11-01', { urgent: true, endDate: '2026-11-03' }), [])).not.toBeNull()
    expect(blockingConstraint(w, shift('2026-11-01', { urgent: true, endDate: '2026-11-02' }), [])).toBeNull()
  })

  it('a past date range is over; weekly ones never are', () => {
    expect(isOver(c({ from: '2026-10-01', to: '2026-10-02' }), '2026-10-28')).toBe(true)
    expect(isOver(c({ when: 'weekdays', weekdays: [1] }), '2026-10-28')).toBe(false)
  })
})

describe('WhatsApp request and reply', () => {
  it('lists the seven days of the week and a notes line', () => {
    const t = requestText('2026-11-01')
    expect(t.split('\n')[0]).toBe('*בקשת אילוצים לשבוע 1.11 עד 7.11.2026*')
    expect(t).toContain('ראשון 1.11: \n')
    expect(t).toContain('שבת 7.11: ')
    expect(t.endsWith('הערות: ')).toBe(true)
  })

  it('reads a filled reply back into constraints', () => {
    const reply = requestText('2026-11-01')
      .replace('ראשון 1.11: ', 'ראשון 1.11: אין אילוץ')
      .replace('שני 2.11: ', 'שני 2.11: לא יכול, חתונה')
      .replace('רביעי 4.11: ', 'רביעי 4.11: בלי לילה')
      .replace('הערות: ', 'הערות: אני בחופש מ-15.11')
    const p = parseReply(reply, '2026-10-25')
    expect(p.weekStart).toBe('2026-11-01')
    expect(p.constraints.map(({ id: _, ...c }) => c)).toEqual([
      { when: 'dates', from: '2026-11-02', to: '2026-11-02', nightsOnly: undefined, note: 'לא יכול, חתונה' },
      { when: 'dates', from: '2026-11-04', to: '2026-11-04', nightsOnly: true, note: 'בלי לילה' },
    ])
    expect(p.notes).toBe('אני בחופש מ-15.11')
  })

  it('uses the chosen week when the header was cut off, and ignores empty notes', () => {
    const p = parseReply('יום שלישי - לא יכול\nחמישי אין\nהערות: אין', '2026-11-01')
    expect(p.weekStart).toBeNull()
    expect(p.constraints.map((c) => c.from)).toEqual(['2026-11-03'])
    expect(p.notes).toBe('')
  })
})
