import { describe, expect, it } from 'vitest'
import { blockingConstraint, constraintError, constraintText, isOver, normalizeConstraint, parseReply, readAnswer, readingText, requestText } from './constraints'
import type { Constraint, ShiftDefinition, ShiftRecord } from '../types/models'

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
      { when: 'dates', from: '2026-11-02', to: '2026-11-02', part: 'evening', note: 'לא יכול, חתונה' },
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

describe("reading a worker's words", () => {
  // Realistic replies and what the manager should see in the preview.
  const cases: [string, string][] = [
    ['לימודים', 'כל היום · לימודים'],
    ['יש לי לימודים עד הערב', 'ערב · לימודים'],
    ['חופש', 'כל היום · חופש'],
    ['בחופש עם המשפחה', 'כל היום · בחופש'],
    ['אירוע', 'ערב · אירוע'],
    ['ארוע בערב', 'ערב · ארוע'],
    ['אירוע בבוקר', 'בוקר · אירוע'],
    ['אירוע משפחתי בצהריים', 'צהריים · אירוע'],
    ['חתונה של אח שלי', 'ערב · חתונה'],
    ['בר מצווה לבן', 'ערב · בר מצווה'],
    ['מילואים', 'כל היום · מילואים'],
    ['חולה', 'כל היום · חולה'],
    ['לא יכול', 'כל היום · לא יכול'],
    ['לא יכול בבוקר', 'בוקר · לא יכול'],
    ['תור לרופא ב-10', 'בוקר · לרופא'],
    ['טיפול שיניים בשעה 14:30', 'צהריים · טיפול'],
    ['יכול רק עד 12, אחרי זה יש לי סידורים', 'צהריים · סידורים'],
    ['בלי לילה', 'בלי לילה'],
    ['לא יכול בלילה', 'בלי לילה · לא יכול'],
    ['אחה"צ אוסף את הילדים', 'צהריים'],
    ['טס לחו"ל', 'כל היום · טס'],
    ['לא יכול כל היום, אירוע', 'כל היום · אירוע'],
    ['בבוקר ובערב', 'כל היום'],
    ['אצל סבתא', 'כל היום (ניחוש, לא הבנתי את המילים)'],
  ]
  it.each(cases)('%s', (answer, understood) => expect(readingText(readAnswer(answer))).toBe(understood))

  it('a date is not an hour', () => expect(readAnswer('חוזר מ-3.11').part).toBeUndefined())
})

describe('part of the day against day and night shifts', () => {
  const defs: ShiftDefinition[] = [
    { id: 'day', name: 'יום', startTime: '07:00', endTime: '16:00' },
    { id: 'night', name: 'לילה', startTime: '20:00', endTime: '16:00' },
  ] as ShiftDefinition[]
  const on = (date: string, part?: Constraint['part']) => ({ constraints: [c({ from: date, to: date, part })] })
  const day = shift('2026-11-02', { shiftDefinitionId: 'day' })
  const night = shift('2026-11-02', { shiftDefinitionId: 'night' })

  it('a day shift is blocked by morning, noon or a whole day, not by an evening', () => {
    expect(blockingConstraint(on('2026-11-02', 'morning'), day, defs)).not.toBeNull()
    expect(blockingConstraint(on('2026-11-02', 'noon'), day, defs)).not.toBeNull()
    expect(blockingConstraint(on('2026-11-02'), day, defs)).not.toBeNull()
    expect(blockingConstraint(on('2026-11-02', 'evening'), day, defs)).toBeNull()
  })

  it('a night job is blocked by any part of its first day, and by all but the evening of the next', () => {
    for (const part of ['morning', 'noon', 'evening', undefined] as const) expect(blockingConstraint(on('2026-11-02', part), night, defs)).not.toBeNull()
    expect(blockingConstraint(on('2026-11-03', 'morning'), night, defs)).not.toBeNull()
    expect(blockingConstraint(on('2026-11-03', 'noon'), night, defs)).not.toBeNull()
    expect(blockingConstraint(on('2026-11-03'), night, defs)).not.toBeNull()
    expect(blockingConstraint(on('2026-11-03', 'evening'), night, defs)).toBeNull()
  })

  it('says the part in the constraint text', () => {
    expect(constraintText(c({ from: '2026-11-02', to: '2026-11-02', part: 'evening' }))).toBe('לא זמין בערב ב-2.11')
  })
})
