import { afterEach, describe, expect, it } from 'vitest'
import { busyWith } from './planner'
import { blockingConstraint } from './constraints'
import { withNightPlus } from './catalog'
import { choicesError, choicesFrom, DEFAULT_CHOICES, typesFromChoices, type PresetKey, type ShiftChoice } from './hourlyShifts'
import { applyFeatureRules } from './featureRules'
import { ALL_ON } from './features'
import type { ShiftDefinition, ShiftRecord } from '../types/models'

// Shifts by hours (smart onboarding stage 2, docs/spikes/hourly-shifts.md). A team without settings.shiftHours
// keeps the whole-day check exactly as before; a team with it gets the hour check.

const def = (id: string, startTime: string, endTime: string, endsNextDay?: boolean): ShiftDefinition => ({
  id,
  name: id,
  startTime,
  endTime,
  ...(endsNextDay ? { endsNextDay } : {}),
  requiredCertificationIds: [],
})
const OLD = [def('day', '07:00', '16:00'), def('night', '07:00', '16:00', true), { ...def('linah', '07:00', '16:00', true), thenJob: true }]
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
const hours = (restHours = 0) => applyFeatureRules(ALL_ON, { on: true, restHours })
const busy = (a: ShiftRecord, b: ShiftRecord) => !!busyWith('w', a, [b], DEFS)
const D = '2026-12-01'
const D1 = '2026-12-02'
const urgent = () => s(D, 'night', { urgent: true, startTime: '20:00', endDate: D1, endTime: '16:00' })

afterEach(() => applyFeatureRules(ALL_ON))

describe('a team without hours: the whole-day check, as before', () => {
  it.each([
    ['day + day same date', s(D, 'day'), s(D, 'day'), true],
    ['night, then day the next morning (allowed, hotel)', s(D1, 'day'), s(D, 'night'), false],
    ['night, then night the next day', s(D1, 'night'), s(D, 'night'), true],
    ['לינה, then day the next day', s(D1, 'day'), s(D, 'linah'), true],
    ['day job, urgent opened 20:00 same day', s(D, 'day'), urgent(), true],
    ['day, then day the next day', s(D1, 'day'), s(D, 'day'), false],
  ])('%s', (_, a, b, expected) => expect(busy(a, b)).toBe(expected))

  it('a switch saved as off is the same as none', () => {
    applyFeatureRules(ALL_ON, { on: false, restHours: 8 })
    expect(busy(s(D, 'day'), urgent())).toBe(true)
  })
})

describe('a team with hours', () => {
  it.each([
    ['morning 07-15 + evening 15-23 same day: free (touching)', s(D, 'morning'), s(D, 'evening'), false],
    ['morning 07-15 + noon 12-20: busy', s(D, 'morning'), s(D, 'noon'), true],
    ['night 23-07 + morning next day: free (touching)', s(D1, 'morning'), s(D, 'night23'), false],
    ['night 23-07 + evening same day 15-23: free', s(D, 'evening'), s(D, 'night23'), false],
    ['two nights in a row: free', s(D1, 'night23'), s(D, 'night23'), false],
    ['urgent 05:00-09:00 + morning 07-15: busy', s(D, 'morning'), s(D, 'morning', { urgent: true, startTime: '05:00', endDate: D, endTime: '09:00' }), true],
    ['night until 16:00 tomorrow, then day the next morning: still allowed (hotel)', s(D1, 'day'), s(D, 'night'), false],
    ['לינה, then day the next day: still busy', s(D1, 'day'), s(D, 'linah'), true],
  ])('%s', (_, a, b, expected) => {
    hours()
    expect(busy(a, b)).toBe(expected)
  })

  it('rest hours between shifts', () => {
    hours(8)
    expect(busy(s(D, 'morning'), s(D, 'evening'))).toBe(true) // 0h between
    expect(busy(s(D1, 'morning'), s(D, 'night23'))).toBe(true) // 0h
    expect(busy(s(D1, 'night23'), s(D, 'night23'))).toBe(false) // 16h
    expect(busy(s(D1, 'morning'), s(D, 'evening'))).toBe(false) // 23:00 -> 07:00 = 8h
    expect(busy(s(D, 'evening'), s(D, 'morning'))).toBe(true) // order does not matter
  })
})

describe('constraints by hours', () => {
  const worker = (c: Partial<import('../types/models').Constraint>) => ({ constraints: [{ id: 'c', when: 'dates' as const, from: D, to: D, ...c }] })
  it('a morning constraint blocks a morning shift but not an evening one', () => {
    hours()
    expect(blockingConstraint(worker({ part: 'morning' }), s(D, 'morning'), DEFS)).not.toBeNull()
    expect(blockingConstraint(worker({ part: 'morning' }), s(D, 'evening'), DEFS)).toBeNull()
  })
  it('an evening constraint blocks an evening shift (15-23) and a noon one (until 20:00), not a morning one', () => {
    hours()
    expect(blockingConstraint(worker({ part: 'evening' }), s(D, 'evening'), DEFS)).not.toBeNull()
    expect(blockingConstraint(worker({ part: 'evening' }), s(D, 'noon'), DEFS)).not.toBeNull()
    expect(blockingConstraint(worker({ part: 'evening' }), s(D, 'morning'), DEFS)).toBeNull()
  })
  it('a whole-day constraint the next day blocks a night that runs into it', () => {
    hours()
    const next = { constraints: [{ id: 'c', when: 'dates' as const, from: D1, to: D1 }] }
    expect(blockingConstraint(next, s(D, 'night23'), DEFS)).not.toBeNull()
    expect(blockingConstraint(next, s(D, 'evening'), DEFS)).toBeNull()
  })
  it('without hours an evening constraint does not block a day job ending 16:00 (as before)', () => {
    expect(blockingConstraint(worker({ part: 'evening' }), s(D, 'day'), DEFS)).toBeNull()
  })
})

describe('the wizard choices become shift types', () => {
  const choices = (...on: PresetKey[]): ShiftChoice[] => DEFAULT_CHOICES.map((c) => ({ ...c, on: on.includes(c.key) }))
  const owners = [
    { ...def('d1', '07:00', '16:00'), name: 'יום' },
    { ...def('n1', '07:00', '16:00', true), name: 'לילה' },
    { ...def('l1', '07:00', '16:00', true), name: 'לינה', thenJob: true },
  ]
  it('a new team gets only what it picked, with the hours', () => {
    const types = typesFromChoices(choices('morning', 'night'), [], false)
    expect(types.map((d) => [d.name, d.startTime, d.endTime, d.endsNextDay])).toEqual([
      ['בוקר', '07:00', '15:00', undefined],
      ['לילה', '23:00', '07:00', undefined],
    ])
  })
  it('the old "לילה" until 16:00 is read as that choice, never as the 23:00 night', () => {
    const c = choicesFrom(owners)
    expect(c.filter((x) => x.on).map((x) => x.key)).toEqual(['morning', 'evening', 'fullDay', 'nightToNoon'])
    const types = typesFromChoices(c, owners, true)
    expect(types.find((d) => d.id === 'n1')).toMatchObject({ name: 'לילה', endsNextDay: true, startTime: '07:00', endTime: '16:00' })
  })
  it('both nights: the old one takes its own name, so the two differ', () => {
    const types = typesFromChoices(choices('night', 'nightToNoon'), owners, true)
    expect(types.find((d) => d.id === 'n1')?.name).toBe('לילה עד מחר 16:00')
    expect(types.filter((d) => d.name === 'לילה')).toHaveLength(1)
  })
  it('a team with saved shifts keeps the types it did not pick', () => {
    const types = typesFromChoices(choices('evening'), OLD, true)
    expect(types.map((d) => d.name)).toEqual(['ערב', 'day', 'night', 'linah'])
  })
  it('the night until 16:00 tomorrow keeps its mark', () => {
    const [t] = typesFromChoices(choices('nightToNoon'), [], false)
    expect(t.endsNextDay).toBe(true)
  })
  it('errors', () => {
    expect(choicesError(choices())).not.toBeNull()
    expect(choicesError([{ key: 'morning', on: true, start: '07:00', end: '07:00' }])).not.toBeNull()
    expect(choicesError(choices('morning'))).toBeNull()
  })
  it('"לינה" is not added for a team with hours', () => {
    hours()
    expect(withNightPlus(HOURS)).toBe(HOURS)
    applyFeatureRules(ALL_ON)
    expect(withNightPlus(HOURS).at(-1)?.thenJob).toBe(true)
  })
})
