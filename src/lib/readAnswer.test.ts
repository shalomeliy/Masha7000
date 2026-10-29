import { describe, expect, it } from 'vitest'
import { blockingConstraint, readAnswer, readingText } from './constraints'
import type { Constraint, ShiftDefinition, ShiftRecord } from '../types/models'

// Realistic answers a worker writes next to a day, and what each must mean.
const CASES: [string, Partial<ReturnType<typeof readAnswer>>][] = [
  ['לימודים', {}],
  ['יש לי לימודים', {}],
  ['חופש', {}],
  ['בחופש עם המשפחה', {}],
  ['אירוע', { part: 'evening' }],
  ['ארוע', { part: 'evening' }],
  ['יש לי אירוע', { part: 'evening' }],
  ['אירוע בצהריים', { part: 'noon' }],
  ['אירוע בבוקר', { part: 'morning' }],
  ['חתונה של אח שלי', { part: 'evening' }],
  ['בר מצווה לבן', { part: 'evening' }],
  ['מילואים', {}],
  ['חולה', {}],
  ['תור לרופא בבוקר', { part: 'morning' }],
  ['תור לרופא', {}],
  ['לא יכול', {}],
  ['לא יכול בערב', { part: 'evening' }],
  ['בלי לילה', { nightsOnly: true }],
  ['לא יכול לילות', { nightsOnly: true }],
  ['יכול רק בבוקר ובצהריים לא', {}], // two times of day: the whole day, to be safe
  ['לימודים כל היום', {}],
  ['טס לחו"ל', {}],
  ['אחה"צ סידורים', { part: 'noon' }],
]

describe('readAnswer', () => {
  it.each(CASES)('"%s"', (answer, expected) => {
    const { cause: _, ...reading } = readAnswer(answer)
    expect(reading).toEqual(expected)
  })

  it('marks words it does not know as a whole-day guess', () => {
    expect(readAnswer('בלה בלה')).toMatchObject({ guess: true })
    expect(readingText(readAnswer('אירוע'))).toBe('ערב · אירוע')
    expect(readingText(readAnswer('לימודים'))).toBe('כל היום · לימודים')
  })
})

const day: ShiftDefinition = { id: 'day', name: 'יום', startTime: '07:00', endTime: '16:00', requiredRoleIds: [], requiredCertificationIds: [] }
const night: ShiftDefinition = { ...day, id: 'night', name: 'לילה', endsNextDay: true }
const shift = (date: string, over: Partial<ShiftRecord> = {}): ShiftRecord => ({
  id: 's',
  date,
  shiftDefinitionId: 'day',
  location: '',
  jobDescription: '',
  crew: [],
  staffing: [],
  ...over,
})
const on = (part?: Constraint['part']) => ({ constraints: [{ id: 'c', when: 'dates' as const, from: '2026-11-02', to: '2026-11-02', part }] })
const blocked = (part: Constraint['part'], r: ShiftRecord) => blockingConstraint(on(part), r, [day, night]) !== null

describe('part of the day against a shift', () => {
  it('an evening constraint leaves the day shift free and blocks the night job starting that day', () => {
    expect(blocked('evening', shift('2026-11-02'))).toBe(false)
    expect(blocked('evening', shift('2026-11-02', { shiftDefinitionId: 'night' }))).toBe(true)
    // The night job of the day before ends at 16:00 on the evening's day.
    expect(blocked('evening', shift('2026-11-01', { shiftDefinitionId: 'night' }))).toBe(false)
  })

  it('morning and noon block the day shift and the night job ending that afternoon', () => {
    for (const part of ['morning', 'noon'] as const) {
      expect(blocked(part, shift('2026-11-02'))).toBe(true)
      expect(blocked(part, shift('2026-11-01', { shiftDefinitionId: 'night' }))).toBe(true)
    }
  })

  it('an urgent shift ending late in the evening is blocked by an evening on its last day', () => {
    expect(blocked('evening', shift('2026-11-01', { urgent: true, endDate: '2026-11-02', endTime: '20:00' }))).toBe(true)
    expect(blocked('evening', shift('2026-11-01', { urgent: true, endDate: '2026-11-02', endTime: '16:00' }))).toBe(false)
  })
})
