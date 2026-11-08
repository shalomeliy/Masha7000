import { describe, expect, it } from 'vitest'
import type { GapContext } from './gaps'
import { fillInsFor, fitsAsIs, moveAdvice, swapOn, swapRecords, troubledCrew } from './moveAdvice'
import { pullFrom } from './planner'
import type { Constraint, ShiftDefinition, ShiftRecord, StaffSlot, Worker } from '../types/models'

const day: ShiftDefinition = { id: 'day', name: 'יום', startTime: '07:00', endTime: '16:00', requiredCertificationIds: [] }
const night: ShiftDefinition = { ...day, id: 'night', name: 'לילה', endsNextDay: true }
const certifications = [{ id: 'h40', name: "אנטנה עד 40מ'" }, { id: 'climber', name: 'טפסן' }]

const worker = (id: string, roleIds: string[] = [], certificationIds: string[] = [], constraints: Constraint[] = []): Worker => ({
  id,
  firstName: id,
  lastName: '',
  certificationIds: [...roleIds, ...certificationIds],
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
const ctx = (workers: Worker[], records: ShiftRecord[]): GapContext => ({ workers, records, defs: [day, night], certifications })
const climbers = (n: number): StaffSlot[] => Array.from({ length: n }, () => ({ certificationIds: ['climber'] }))
const crew = (...ids: string[]) => ids.map((workerId) => ({ workerId }))

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
    const s = shift('s', '2026-10-27', { staffing: [{ certificationIds: ['climber', 'h40'] }], crew: crew('a') })
    expect(fitsAsIs(s, '2026-10-28', ctx([worker('a', ['climber'])], [s]))).toBe(false)
  })
})

describe('swapOn', () => {
  it('swaps a blocked member for a free one of the same role and certification', () => {
    const staffing: StaffSlot[] = [{ certificationIds: ['climber', 'h40'] }, { certificationIds: ['climber'] }]
    const s = shift('s', '2026-10-27', { staffing, crew: crew('a', 'b') })
    const ws = [worker('a', ['climber'], ['h40'], [off('2026-10-27')]), worker('b', ['climber']), worker('c', ['climber']), worker('d', ['climber'], ['h40'])]
    const advice = swapOn(s, '2026-10-27', ctx(ws, [s]))!
    expect(advice.swaps.map((x) => [x.out?.id, x.in.id])).toEqual([['a', 'd']])
    expect(advice.shift.crew.map((c) => c.workerId).sort()).toEqual(['b', 'd'])
    expect(swapRecords(advice.swaps, 'T')).toEqual([{ at: 'T', outId: 'a', inId: 'd' }])
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

describe('taking a worker out of another job', () => {
  // a is away all week; b fits but is in another job on Tuesday and free from Thursday.
  const s = shift('s', '2026-10-25', { staffing: climbers(1), crew: crew('a') })
  const other = shift('o', '2026-10-27', { crew: crew('b') })
  const ws = [worker('a', ['climber'], [], [off('2026-10-25', '2026-10-31')]), worker('b', ['climber'], [], [off('2026-10-25', '2026-10-26'), off('2026-10-28')])]

  it('swapOn with pull takes a busy worker, and says from which job', () => {
    const c = ctx(ws, [s, other])
    expect(swapOn(s, '2026-10-27', c)).toBeNull()
    const advice = swapOn(s, '2026-10-27', c, true)!
    expect(advice.swaps.map((x) => [x.out?.id, x.in.id, x.from?.id])).toEqual([['a', 'b', 'o']])
  })

  it('moveAdvice offers the pull only when it is earlier than a free swap', () => {
    const advice = moveAdvice(s, '2026-10-25', ctx(ws, [s, other]))
    expect(advice.pull?.date).toBe('2026-10-27')
    expect(advice.swap?.date).toBe('2026-10-29')
    expect(advice.fitDate).toBe('2026-11-01')
  })

  it('a constraint still keeps a busy worker out', () => {
    expect(swapOn(s, '2026-10-28', ctx(ws, [s, shift('o2', '2026-10-28', { crew: crew('b') })]), true)).toBeNull()
  })
})

describe('pullFrom', () => {
  it('takes the worker out of the other job at the same time only', () => {
    const s = shift('s', '2026-10-27', { crew: crew('b') })
    const same = shift('o', '2026-10-27', { crew: crew('b', 'c') })
    const later = shift('l', '2026-10-29', { crew: crew('b') })
    const out = pullFrom(s, ['b'], [s, same, later], [day, night])
    expect(out.map((r) => r.crew.map((c) => c.workerId))).toEqual([['b'], ['c'], ['b']])
    expect(out[2]).toBe(later)
  })
})

describe('filling the place a pulled worker leaves', () => {
  const s = shift('s', '2026-10-27', { staffing: climbers(1), crew: crew('b') })
  const other = shift('o', '2026-10-27', { staffing: [{ certificationIds: ['climber', 'h40'] }], crew: crew('b') })

  it('pullFrom puts the fill-in in the pulled worker\'s place and keeps it in the history', () => {
    const out = pullFrom(s, ['b'], [s, other], [day, night], { b: 'c' }, 'T')
    expect(out[1].crew).toEqual([{ workerId: 'c' }])
    expect(out[1].swaps).toEqual([{ at: 'T', outId: 'b', inId: 'c' }])
  })

  it('fillInsFor offers free workers with the place\'s role and certification only', () => {
    const ws = [
      worker('b', ['climber'], ['h40']),
      worker('c', ['climber'], ['h40']),
      worker('d', ['climber']), // no certification
      worker('e', ['climber'], ['h40'], [off('2026-10-27')]), // off that day
      worker('f', ['climber'], ['h40']), // in the job b moves into
    ]
    const fillIns = fillInsFor(other, 'b', ctx(ws, [s, other]), ['b', 'f'])
    expect(fillIns.map((w) => w.id)).toEqual(['c'])
  })
})
