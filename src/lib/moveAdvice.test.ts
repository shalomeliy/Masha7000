import { describe, expect, it } from 'vitest'
import type { GapContext } from './gaps'
import { fitsAsIs, moveAdvice, swapOn, swapRecords, troubledCrew } from './moveAdvice'
import type { Constraint, ShiftDefinition, ShiftRecord, StaffSlot, Worker } from '../types/models'

const day: ShiftDefinition = { id: 'day', name: 'יום', startTime: '07:00', endTime: '16:00', requiredRoleIds: [], requiredCertificationIds: [] }
const night: ShiftDefinition = { ...day, id: 'night', name: 'לילה', endsNextDay: true }
const G = 'general'
const roles = [
  { id: G, name: 'כללי' },
  { id: 'climber', name: 'טפסן' },
]
const certifications = [{ id: 'h40', name: "אנטנה עד 40מ'" }]

const worker = (id: string, roleIds: string[] = [], certificationIds: string[] = [], constraints: Constraint[] = []): Worker => ({
  id,
  firstName: id,
  lastName: '',
  roleIds,
  certificationIds,
  constraints,
})
const off = (from: string, to = from): Constraint => ({ id: `${from}-${to}`, when: 'dates', from, to })
const shift = (id: string, date: string, over: Partial<ShiftRecord> = {}): ShiftRecord => ({
  id,
  date,
  shiftDefinitionId: 'day',
  location: 'חיפה',
  jobDescription: 'עבודה',
  crew: [],
  staffing: [],
  ...over,
})
const ctx = (workers: Worker[], records: ShiftRecord[]): GapContext => ({ workers, records, defs: [day, night], roles, certifications, generalId: G })
const climbers = (n: number): StaffSlot[] => Array.from({ length: n }, () => ({ roleId: 'climber' }))
const crew = (...ids: string[]) => ids.map((workerId) => ({ workerId, roleId: 'climber' }))

// 2026-10-25 is a Sunday.
describe('troubledCrew and fitsAsIs', () => {
  it('a crew member off on that day is troubled; on another day the same crew fits', () => {
    const s = shift('s', '2026-10-27', { staffing: climbers(2), crew: crew('a', 'b') })
    const c = ctx([worker('a', ['climber'], [], [off('2026-10-27')]), worker('b', ['climber'])], [s])
    expect(troubledCrew(s, c)).toEqual(['a'])
    expect(fitsAsIs(s, '2026-10-27', c)).toBe(false)
    expect(fitsAsIs(s, '2026-10-28', c)).toBe(true)
  })

  it('sick, inactive and busy members are troubled', () => {
    const s = shift('s', '2026-10-27', { staffing: climbers(3), crew: crew('a', 'b', 'c') })
    const other = shift('o', '2026-10-27', { crew: crew('c') })
    const ws = [worker('a', ['climber']), worker('b', ['climber']), worker('c', ['climber'])]
    ws[0] = { ...ws[0], status: 'sick', sickUntil: '2026-10-30' }
    ws[1] = { ...ws[1], status: 'inactive' }
    expect(troubledCrew(s, ctx(ws, [s, other]))).toEqual(['a', 'b', 'c'])
  })

  it('a place left empty for want of a certification never fits as is', () => {
    const s = shift('s', '2026-10-27', { staffing: [{ roleId: 'climber', certificationId: 'h40' }], crew: crew('a') })
    expect(fitsAsIs(s, '2026-10-28', ctx([worker('a', ['climber'])], [s]))).toBe(false)
  })
})

describe('swapOn', () => {
  it('swaps a blocked member for a free one of the same role and certification', () => {
    const staffing: StaffSlot[] = [{ roleId: 'climber', certificationId: 'h40' }, { roleId: 'climber' }]
    const s = shift('s', '2026-10-27', { staffing, crew: crew('a', 'b') })
    const ws = [worker('a', ['climber'], ['h40'], [off('2026-10-27')]), worker('b', ['climber']), worker('c', ['climber']), worker('d', ['climber'], ['h40'])]
    const advice = swapOn(s, '2026-10-27', ctx(ws, [s]))!
    expect(advice.swaps.map((x) => [x.out?.id, x.in.id])).toEqual([['a', 'd']])
    expect(advice.shift.crew.map((c) => c.workerId).sort()).toEqual(['b', 'd'])
    expect(swapRecords(advice.swaps, 'T')).toEqual([{ at: 'T', outId: 'a', inId: 'd', roleId: 'climber' }])
  })

  it('fills an empty place too, with no one swapped out', () => {
    const s = shift('s', '2026-10-27', { staffing: climbers(2), crew: crew('a') })
    const advice = swapOn(s, '2026-10-27', ctx([worker('a', ['climber']), worker('b', ['climber'])], [s]))!
    expect(advice.swaps.map((x) => [x.out?.id, x.in.id])).toEqual([[undefined, 'b']])
    expect(swapRecords(advice.swaps, 'T')).toEqual([])
  })

  it('gives nothing when no one can take the place, or when it already fits', () => {
    const s = shift('s', '2026-10-27', { staffing: climbers(1), crew: crew('a') })
    expect(swapOn(s, '2026-10-27', ctx([worker('a', ['climber'], [], [off('2026-10-27')])], [s]))).toBeNull()
    expect(swapOn(s, '2026-10-28', ctx([worker('a', ['climber'], [], [off('2026-10-27')]), worker('b', ['climber'])], [s]))).toBeNull()
  })

  it('more than two workers to change is not a swap', () => {
    const s = shift('s', '2026-10-27', { staffing: climbers(3), crew: crew('a', 'b', 'c') })
    const ws = ['a', 'b', 'c'].map((id) => worker(id, ['climber'], [], [off('2026-10-27')])).concat(['d', 'e', 'f'].map((id) => worker(id, ['climber'])))
    expect(swapOn(s, '2026-10-27', ctx(ws, [s]))).toBeNull()
  })

  it('warns, without blocking, about a replacement over the weekly night limit', () => {
    const n = shift('s', '2026-10-27', { shiftDefinitionId: 'night', staffing: climbers(1), crew: crew('a') })
    const nights = ['2026-10-25', '2026-10-29'].map((d, i) => shift(`n${i}`, d, { shiftDefinitionId: 'night', crew: crew('b') }))
    const advice = swapOn(n, '2026-10-27', ctx([worker('a', ['climber'], [], [off('2026-10-27')]), worker('b', ['climber'])], [n, ...nights]))!
    expect(advice.swaps[0].in.id).toBe('b')
    expect(advice.nightIds).toEqual(['b'])
  })
})

describe('moveAdvice', () => {
  // a is away all week; a free replacement exists from Tuesday.
  const s = shift('s', '2026-10-25', { staffing: climbers(1), crew: crew('a') })
  const ws = [worker('a', ['climber'], [], [off('2026-10-25', '2026-10-31')]), worker('b', ['climber'], [], [off('2026-10-25', '2026-10-26')])]

  it('the earliest day with the same crew, and an earlier one with a swap', () => {
    const advice = moveAdvice(s, '2026-10-25', ctx(ws, [s]))
    expect(advice.fitDate).toBe('2026-11-01')
    expect(advice.swap?.date).toBe('2026-10-27')
    expect(advice.swap?.swaps.map((x) => [x.out?.id, x.in.id])).toEqual([['a', 'b']])
  })

  it('no swap advice when the same crew fits first', () => {
    const advice = moveAdvice(s, '2026-11-01', ctx(ws, [s]))
    expect(advice).toEqual({ fitDate: '2026-11-01' })
  })

  it('skips the job\'s own day', () => {
    const free = shift('f', '2026-10-25', { staffing: climbers(1), crew: crew('b') })
    expect(moveAdvice(free, '2026-10-25', ctx([worker('b', ['climber'])], [free])).fitDate).toBe('2026-10-26')
  })
})
