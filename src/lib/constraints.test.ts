import { describe, expect, it } from 'vitest'
import { blockedCrew, blockingConstraint, constraintError, constraintText, isOver, mergeReply, normalizeConstraint, parseReply, readAnswer, readingText, requestText } from './constraints'
import type { Constraint, ShiftDefinition, ShiftRecord, Worker } from '../types/models'

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
    expect(t).toContain('\nהערות: \n')
    expect(t.endsWith('*ניתן לשלוח את התשובה עד סוף יום העבודה, 17:00 לכל המאוחר.*')).toBe(true)
  })

  it('reads a filled reply back into constraints', () => {
    const reply = requestText('2026-11-01')
      .replace('ראשון 1.11: ', 'ראשון 1.11: אין אילוץ')
      .replace('שני 2.11: ', 'שני 2.11: לא יכול, חתונה')
      .replace('רביעי 4.11: ', 'רביעי 4.11: בלי לילה')
      .replace('הערות: ', 'הערות: אני בחופש מ-15.11')
    const p = parseReply(reply, '2026-10-25')
    expect(p.weekStart).toBe('2026-11-01')
    expect(p.constraints.map(({ id: _, reply: __, ...c }) => c)).toEqual([
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

describe('weekly constraint with a last date', () => {
  const weekly = (to?: string) => c({ when: 'weekdays', weekdays: [1], to })

  it('blocks that weekday until the last date, then stops', () => {
    expect(blockingConstraint({ constraints: [weekly('2026-11-16')] }, shift('2026-11-16'), [])).not.toBeNull()
    expect(blockingConstraint({ constraints: [weekly('2026-11-16')] }, shift('2026-11-23'), [])).toBeNull()
    expect(blockingConstraint({ constraints: [weekly()] }, shift('2027-06-07'), [])).not.toBeNull()
  })

  it('says the last date, and is over after it', () => {
    expect(constraintText(weekly('2026-11-16'))).toBe('לא זמין ביום שני עד 16.11')
    expect(isOver(weekly('2026-11-16'), '2026-11-17')).toBe(true)
    expect(isOver(weekly(), '2030-01-01')).toBe(false)
    expect(normalizeConstraint(weekly('2026-11-16')).to).toBe('2026-11-16')
  })

  it('reads "כל שבוע עד" from a WhatsApp reply', () => {
    const p = parseReply('שני 2.11: לימודים, כל שבוע עד 15.2\nרביעי: חוג קבוע\nחמישי: לימודים עד 10.3.27 כל שבוע', '2026-11-01')
    expect(p.constraints.map(({ id: _, reply: __, ...x }) => x)).toEqual([
      { when: 'weekdays', weekdays: [1], from: '2026-11-02', to: '2027-02-15', note: 'לימודים, כל שבוע עד 15.2' },
      { when: 'weekdays', weekdays: [3], from: '2026-11-04', to: undefined, part: 'evening', note: 'חוג קבוע' },
      { when: 'weekdays', weekdays: [4], from: '2026-11-05', to: '2027-03-10', note: 'לימודים עד 10.3.27 כל שבוע' },
    ])
  })
})

describe('more words', () => {
  it.each([
    ['ברית לאחיין', 'בוקר · ברית'],
    ['לפני הצהריים בדיקה', 'בוקר · בדיקה'],
    ['איסוף ילדים מהגן', 'צהריים'],
    ['השתלמות', 'כל היום · השתלמות'],
    ['שבע ברכות', 'ערב · שבע ברכות'],
    ['נוסע לחול', 'כל היום · לחול'],
    ['בחו"ל עם המשפחה', 'כל היום · בחו"ל'],
    ['חג', 'כל היום · חג'],
    ['ערב חג', 'כל היום · ערב חג'],
    ['איסרו חג', 'כל היום · איסרו חג'],
    ['עסוק', 'כל היום (ניחוש, לא הבנתי את המילים)'],
  ])('%s', (answer, understood) => expect(readingText(readAnswer(answer))).toBe(understood))
})

describe('pasting a corrected reply', () => {
  it('replaces what the earlier paste of the same week added, and keeps the rest', () => {
    const first = parseReply('שני: חופש\nשלישי: אירוע', '2026-11-01').constraints
    const byHand = c({ id: 'hand', from: '2026-11-03', to: '2026-11-03' })
    const otherWeek = parseReply('שני: חופש', '2026-11-08').constraints
    const corrected = parseReply('שני: לימודים', '2026-11-01').constraints
    const after = mergeReply([...first, byHand, ...otherWeek], corrected, '2026-11-01')
    expect(after.map((x) => x.note)).toEqual([undefined, 'חופש', 'לימודים'])
    expect(after.map((x) => x.reply)).toEqual([undefined, '2026-11-08', '2026-11-01'])
  })

  it('tags each constraint with the week of the reply, from its header when kept', () => {
    expect(parseReply(requestText('2026-11-15').replace('שני 16.11: ', 'שני 16.11: חופש'), '2026-11-01').constraints[0].reply).toBe('2026-11-15')
  })
})

describe('a later reply ends an earlier weekly constraint', () => {
  const studies = parseReply('שני: לימודים כל שבוע עד 15.2', '2026-11-01').constraints

  it('ends it the day before the new week, so it stops blocking from then on', () => {
    const after = mergeReply(studies, parseReply('שלישי: אירוע', '2026-11-22').constraints, '2026-11-22')
    expect(after[0]).toMatchObject({ when: 'weekdays', from: '2026-11-02', to: '2026-11-21' })
    expect(blockingConstraint({ constraints: after }, shift('2026-11-16'), [])).not.toBeNull()
    expect(blockingConstraint({ constraints: after }, shift('2026-11-23'), [])).toBeNull()
    expect(after[1].note).toBe('אירוע')
  })

  it('keeps it when the worker writes it again, and leaves weekly ones added by hand', () => {
    const byHand = c({ id: 'hand', when: 'weekdays', weekdays: [4] })
    const after = mergeReply([...studies, byHand], parseReply('שני: לימודים כל שבוע עד 15.2', '2026-11-22').constraints, '2026-11-22')
    expect(after.map((x) => [x.from, x.to])).toEqual([
      ['2026-11-02', '2026-11-21'],
      [undefined, undefined],
      ['2026-11-23', '2027-02-15'],
    ])
  })

  it('does not start before the week it was written in', () => {
    expect(blockingConstraint({ constraints: studies }, shift('2026-10-26'), [])).toBeNull()
  })
})

describe('blockedCrew', () => {
  const w = (id: string, constraints: Constraint[] = []): Worker => ({ id, firstName: id, lastName: '', roleIds: [], certificationIds: [], constraints })
  const workers = [w('free'), w('away', [c({ from: '2026-11-03', to: '2026-11-03', note: 'חתונה' })])]
  const crew = [
    { workerId: 'free', roleId: 'general' },
    { workerId: 'away', roleId: 'general' },
  ]

  it('finds the crew member a constraint blocks after the shift moves to that day', () => {
    expect(blockedCrew(shift('2026-11-02', { crew }), workers, [])).toEqual([])
    expect(blockedCrew(shift('2026-11-03', { crew }), workers, []).map((b) => b.worker.id)).toEqual(['away'])
  })
})
