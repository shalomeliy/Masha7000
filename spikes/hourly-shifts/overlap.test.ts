import { describe, expect, it } from 'vitest'
import { busyWith } from './overlap'
import type { ShiftDefinition, ShiftRecord } from '../../src/types/models'

const def = (id: string, startTime: string, endTime: string, endsNextDay?: boolean): ShiftDefinition => ({
  id,
  name: id,
  startTime,
  endTime,
  ...(endsNextDay ? { endsNextDay } : {}),
  requiredCertificationIds: [],
})
// The owner's team today.
const OLD = [def('day', '07:00', '16:00'), def('night', '07:00', '16:00', true), { ...def('linah', '07:00', '16:00', true), thenJob: true }]
// A new customer's hourly types (spec suggestion).
const HOURS = [def('morning', '07:00', '15:00'), def('noon', '12:00', '20:00'), def('evening', '15:00', '23:00'), def('night23', '23:00', '07:00')]
const DEFS = [...OLD, ...HOURS]

let n = 0
const s = (date: string, type: string, over: Partial<ShiftRecord> = {}): ShiftRecord => ({
  id: `s${n++}`,
  date,
  shiftDefinitionId: type,
  location: '',
  jobDescription: 'x',
  crew: [{ workerId: 'w' }],
  staffing: [],
  ...over,
})
const busy = (hourly: boolean, a: ShiftRecord, b: ShiftRecord, rest = 0) => !!busyWith(hourly, 'w', a, [b], DEFS, rest)

describe('old team: nothing changes (switch off = the code in use today)', () => {
  const D = '2026-12-01'
  const D1 = '2026-12-02'
  const urgent = s(D, 'night', { urgent: true, startTime: '20:00', endDate: D1, endTime: '16:00' })
  it.each([
    ['day + day same date', s(D, 'day'), s(D, 'day'), true],
    ['night, then day the next morning (allowed, hotel)', s(D1, 'day'), s(D, 'night'), false],
    ['night, then night the next day', s(D1, 'night'), s(D, 'night'), true],
    ['לינה, then day the next day', s(D1, 'day'), s(D, 'linah'), true],
    ['day job, urgent opened 20:00 same day', s(D, 'day'), urgent, true],
  ])('%s', (_, a, b, expected) => expect(busy(false, a, b)).toBe(expected))

  it('the hour check would change the old team, so it must stay behind the switch', () => {
    // Day 07-16 and an urgent job from 20:00 do not overlap in hours, but today the app calls it busy.
    expect(busy(true, s(D, 'day'), urgent)).toBe(false)
    // Night until 16:00 and a day job the next morning overlap in hours; today the app allows it.
    expect(busy(true, s(D1, 'day'), s(D, 'night'))).toBe(true)
  })
})

describe('hourly team', () => {
  const D = '2026-12-01'
  const D1 = '2026-12-02'
  it.each([
    ['morning 07-15 + evening 15-23 same day: free (touching)', s(D, 'morning'), s(D, 'evening'), false],
    ['morning 07-15 + noon 12-20: busy', s(D, 'morning'), s(D, 'noon'), true],
    ['night 23-07 + morning next day 07-15: free (touching)', s(D1, 'morning'), s(D, 'night23'), false],
    ['night 23-07 + evening same day 15-23: free', s(D, 'evening'), s(D, 'night23'), false],
    ['night 23-07 + noon next day: free', s(D1, 'noon'), s(D, 'night23'), false],
    ['two nights in a row: free (07 to 23)', s(D1, 'night23'), s(D, 'night23'), false],
    ['urgent 05:00-09:00 + morning 07-15: busy', s(D, 'morning'), s(D, 'morning', { urgent: true, startTime: '05:00', endDate: D, endTime: '09:00' }), true],
  ])('%s', (_, a, b, expected) => expect(busy(true, a, b)).toBe(expected))

  it('8 hours rest: morning then evening the same day is too close, night then next night is fine', () => {
    expect(busy(true, s(D, 'morning'), s(D, 'evening'), 8)).toBe(true)
    expect(busy(true, s(D1, 'morning'), s(D, 'night23'), 8)).toBe(true)
    expect(busy(true, s(D1, 'night23'), s(D, 'night23'), 8)).toBe(false)
    expect(busy(true, s(D1, 'morning'), s(D, 'evening'), 8)).toBe(false) // 23:00 -> 07:00 = 8h
  })
})
