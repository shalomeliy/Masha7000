import { describe, expect, it } from 'vitest'
import type { GapContext } from './gaps'
import { swapOn } from './moveAdvice'
import { datesForPinned, nearestDates, pinnedOf } from './pinnedDates'
import { autoAssign } from './planner'
import type { Constraint, ShiftDefinition, ShiftRecord, StaffSlot, Worker } from '../types/models'

const day: ShiftDefinition = { id: 'day', name: 'יום', startTime: '07:00', endTime: '16:00', requiredCertificationIds: [] }
const night: ShiftDefinition = { ...day, id: 'night', name: 'לילה', endsNextDay: true }
const G = 'general'
const worker = (id: string, roleIds: string[] = ['climber'], constraints: Constraint[] = []): Worker => ({ id, firstName: id, lastName: '', certificationIds: roleIds, constraints })
const off = (from: string, to = from): Constraint => ({ id: `${from}-${to}`, when: 'dates', from, to })
const shift = (id: string, date: string, over: Partial<ShiftRecord> = {}): ShiftRecord => ({ id, date, shiftDefinitionId: 'day', location: 'ערד', jobDescription: 'עבודה', crew: [], staffing: [], ...over })
const ctx = (workers: Worker[], records: ShiftRecord[] = []): GapContext => ({ workers, records, defs: [day, night], certifications: [{ id: 'climber', name: 'טפסן' }, { id: 'elec', name: 'חשמלאי' }] })
const slots = (...ids: string[]): StaffSlot[] => ids.map((id) => (id === G ? {} : { certificationIds: [id] }))

// 2026-11-08 is a Sunday.
describe('datesForPinned', () => {
  it('offers the nearest days both pinned workers are free, at most 3', () => {
    const yossi = worker('yossi', ['climber'], [off('2026-11-08', '2026-11-09')])
    const nir = worker('nir')
    const job = shift('new', '2026-11-08', { staffing: slots('climber', 'climber') })
    // ניר is in another job on the 10th.
    const other = shift('o', '2026-11-10', { crew: [{ workerId: 'nir' }] })
    const got = datesForPinned(job, ['yossi', 'nir'], '2026-11-08', ctx([yossi, nir], [other]))
    expect(got.map((o) => o.date)).toEqual(['2026-11-11', '2026-11-12', '2026-11-13'])
    expect(got[0].shift.crew.map((c) => c.workerId).sort()).toEqual(['nir', 'yossi'])
    expect(got[0].shift.pinnedIds).toEqual(['yossi', 'nir'])
    expect(got[0].addedIds).toEqual([])
  })

  it('fills the extra places with others, and skips days without enough of them', () => {
    const yossi = worker('yossi')
    const dani = worker('dani', ['elec'], [off('2026-11-08')])
    const job = shift('new', '2026-11-08', { staffing: slots('climber', 'elec') })
    const got = datesForPinned(job, ['yossi'], '2026-11-08', ctx([yossi, dani]), 1)
    expect(got).toHaveLength(1)
    expect(got[0].date).toBe('2026-11-09')
    expect(got[0].addedIds).toEqual(['dani'])
  })

  it('a night job blocks the next day too, and the night limit is only a warning', () => {
    const yossi = worker('yossi')
    const n1 = shift('n1', '2026-11-08', { shiftDefinitionId: 'night', crew: [{ workerId: 'yossi' }] })
    const n2 = shift('n2', '2026-11-10', { shiftDefinitionId: 'night', crew: [{ workerId: 'yossi' }] })
    const job = shift('new', '2026-11-08', { shiftDefinitionId: 'night', staffing: slots('climber') })
    const got = datesForPinned(job, ['yossi'], '2026-11-08', ctx([yossi], [n1, n2]), 1)
    // 8-9 and 10-11 are taken; the 12th starts a night ending on the 13th.
    expect(got[0].date).toBe('2026-11-12')
    expect(got[0].nightIds).toEqual(['yossi'])
  })

  it('finds nothing for an inactive worker, and nothing when a worker is unknown', () => {
    const gone = { ...worker('gone'), status: 'inactive' as const }
    expect(datesForPinned(shift('new', '2026-11-08'), ['gone'], '2026-11-08', ctx([gone]))).toEqual([])
    expect(datesForPinned(shift('new', '2026-11-08'), ['nobody'], '2026-11-08', ctx([worker('a')]))).toEqual([])
  })
})

describe('nearestDates ("בחירה אוטומטית")', () => {
  it('offers the nearest days every place can be filled, and more of them on "עוד 3"', () => {
    const a = worker('a', ['climber'], [off('2026-11-08', '2026-11-09')])
    const b = worker('b', ['climber'])
    const job = shift('new', '2026-11-08', { staffing: slots('climber', 'climber') })
    const c = ctx([a, b])
    expect(nearestDates(job, '2026-11-08', c).map((o) => o.date)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12'])
    expect(nearestDates(job, '2026-11-08', c, 6).map((o) => o.date)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'])
    expect(nearestDates(job, '2026-11-08', c)[0].addedIds.sort()).toEqual(['a', 'b'])
  })

  it('keeps the workers who must be in it, and finds nothing when nobody fits', () => {
    const a = worker('a', ['climber'], [off('2026-11-10')])
    const b = worker('b', ['climber'])
    const job = shift('new', '2026-11-08', { staffing: slots('climber'), crew: [{ workerId: 'a' }], pinnedIds: ['a'] })
    const got = nearestDates(job, '2026-11-10', ctx([a, b]), 1)
    expect(got[0].date).toBe('2026-11-11')
    expect(got[0].shift.crew).toEqual([{ workerId: 'a' }])
    expect(nearestDates(shift('new', '2026-11-08', { staffing: slots('elec') }), '2026-11-08', ctx([b]))).toEqual([])
  })
})

describe('pinned workers stay in the job', () => {
  it('"שבץ" fills around them', () => {
    const job = shift('j', '2026-11-08', { staffing: slots('climber', 'climber'), crew: [{ workerId: 'yossi' }], pinnedIds: ['yossi'] })
    const plan = autoAssign(job, job.staffing, ctx([worker('a'), worker('yossi'), worker('b')]))
    expect(plan.crew.map((c) => c.workerId)).toContain('yossi')
  })

  it('swap advice never takes a pinned worker out', () => {
    const yossi = worker('yossi', ['climber'], [off('2026-11-09')])
    const job = shift('j', '2026-11-08', { staffing: slots('climber'), crew: [{ workerId: 'yossi' }] })
    const c = ctx([yossi, worker('a')])
    expect(swapOn(job, '2026-11-09', c)?.swaps[0].in.id).toBe('a')
    expect(swapOn({ ...job, pinnedIds: ['yossi'] }, '2026-11-09', c)).toBeNull()
  })

  it('only workers still in the crew count as pinned', () => {
    expect(pinnedOf({ crew: [{ workerId: 'a' }], pinnedIds: ['a', 'b'] })).toEqual(['a'])
  })
})
