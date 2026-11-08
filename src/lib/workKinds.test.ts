import { describe, expect, it } from 'vitest'
import { emptyPlaces } from './gaps'
import { autoAssign, type PlanContext } from './planner'
import { starterKinds, toggleKind } from './workKinds'
import type { ShiftDefinition, ShiftRecord, StaffSlot, Worker, WorkKind } from '../types/models'

const MGR = 'mgr'
const CLIMB = 'climb'
const WELD = 'weld'

const day: ShiftDefinition = { id: 'day', name: 'יום', startTime: '07:00', endTime: '16:00', requiredCertificationIds: [] }
const worker = (id: string, roleIds: string[] = [], certificationIds: string[] = []): Worker => ({
  id,
  firstName: id,
  lastName: '',
  certificationIds: [...roleIds, ...certificationIds],
  constraints: [],
})
const climbing: WorkKind = { id: 'k-climb', name: 'טיפוס', staffing: [{ certificationIds: [MGR] }, { certificationIds: [CLIMB] }, { certificationIds: [CLIMB] }] }
const welding: WorkKind = { id: 'k-weld', name: 'ריתוך', staffing: [{ certificationId: WELD }] }
const job = (staffing: StaffSlot[], crew: ShiftRecord['crew'] = []): ShiftRecord => ({
  id: 'j',
  date: '2026-11-03',
  shiftDefinitionId: 'day',
  location: 'חיפה',
  jobDescription: '',
  crew,
  staffing,
})
const ctx = (workers: Worker[]): PlanContext => ({ workers, records: [], defs: [day] })
const both = () => toggleKind(toggleKind({ staffing: [{}] }, climbing), welding)

describe('toggleKind', () => {
  it('replaces the default single place with the kind places, and combines kinds', () => {
    const one = toggleKind({ staffing: [{}] }, climbing)
    expect(one.workKindIds).toEqual(['k-climb'])
    expect(one.staffing).toHaveLength(3)
    expect(one.staffing.every((s) => s.kindId === 'k-climb')).toBe(true)
    expect(both().staffing).toHaveLength(4)
  })

  it('keeps places added by hand and removes only the kind places', () => {
    const start = { staffing: [{ certificationIds: [CLIMB] }, {}] }
    const on = toggleKind(start, welding)
    expect(on.staffing).toHaveLength(3)
    const off = toggleKind(on, welding)
    expect(off.staffing).toEqual(start.staffing)
    expect(off.workKindIds).toEqual([])
  })

  it('replaces several bare "כללי" places too, so a second tap never piles places up', () => {
    const three = { staffing: [{}, {}, {}] }
    const on = toggleKind(toggleKind(three, welding), climbing)
    expect(on.staffing).toHaveLength(4)
    expect(on.staffing.every((s) => s.kindId)).toBe(true)
    expect(toggleKind(toggleKind(on, welding), climbing).staffing).toEqual([{}])
  })

  it('leaves one "כללי" place when the last kind goes', () => {
    expect(toggleKind(toggleKind({ staffing: [{}] }, welding), welding).staffing).toEqual([{}])
  })
})

describe('autoAssign with work kinds', () => {
  it('a climber who welds covers the welding place too: 3 people, not 4', () => {
    const { staffing } = both()
    const workers = [worker('a-mgr', [MGR]), worker('b-climb', [CLIMB]), worker('c-climb', [CLIMB]), worker('d-climbweld', [CLIMB], [WELD]), worker('e-weld', [], [WELD])]
    const plan = autoAssign(job(staffing), staffing, ctx(workers))
    expect(plan.unfilled).toEqual([])
    expect(plan.crew.map((c) => c.workerId).sort()).toEqual(['a-mgr', 'b-climb', 'd-climbweld'])
  })

  it('two places of one kind never share a worker', () => {
    const { staffing } = toggleKind({ staffing: [{}] }, climbing)
    const plan = autoAssign(job(staffing), staffing, ctx([worker('m1', [MGR, CLIMB]), worker('m2', [MGR, CLIMB]), worker('m3', [MGR, CLIMB], [WELD])]))
    expect(plan.unfilled).toEqual([])
    expect(plan.crew).toHaveLength(3)
  })

  it('a welder with no climbing certification is added as a fourth person', () => {
    const { staffing } = both()
    const workers = [worker('a', [MGR]), worker('b', [CLIMB]), worker('c', [CLIMB]), worker('w', [], [WELD])]
    const plan = autoAssign(job(staffing), staffing, ctx(workers))
    expect(plan.unfilled).toEqual([])
    expect(plan.crew).toHaveLength(4)
  })

  it('a hand-picked climber who welds also counts for the welding place', () => {
    const { staffing } = both()
    const workers = [worker('a', [MGR]), worker('b', [CLIMB]), worker('d', [CLIMB], [WELD])]
    const crew = [{ workerId: 'a' }, { workerId: 'b' }, { workerId: 'd' }]
    expect(emptyPlaces(job(staffing, crew), staffing, workers)).toEqual([])
    expect(autoAssign(job(staffing, crew), staffing, ctx(workers)).crew).toHaveLength(3)
  })
})

describe('starterKinds', () => {
  it('adds the missing certifications: טיפוס is 3 people, 2 of them with "טיפוס"', () => {
    const r = starterKinds([])
    expect(r.certs.map((x) => x.name)).toEqual(['טיפוס', 'רתך'])
    expect(r.kinds.map((k) => [k.name, k.staffing.length])).toEqual([
      ['טיפוס', 3],
      ['ריתוך', 1],
    ])
    const climb = r.certs[0].id
    expect(r.kinds[0].staffing).toEqual([{}, { certificationIds: [climb] }, { certificationIds: [climb] }])
  })

  it('uses the existing certifications', () => {
    const r = starterKinds([{ id: 'c', name: 'רתך' }, { id: 't', name: 'טיפוס' }])
    expect(r.certs).toEqual([])
    expect(r.kinds[0].staffing).toEqual([{}, { certificationIds: ['t'] }, { certificationIds: ['t'] }])
    expect(r.kinds[1].staffing[0].certificationIds).toEqual(['c'])
  })
})

describe('a kind saved while roles existed', () => {
  it('its places keep only their certifications in a job', () => {
    const old = { id: 'k', name: 'טיפוס', staffing: [{ roleId: 'mgr' }, { roleId: 'g', certificationIds: [CLIMB], altRoleIds: ['x'] }] } as never as WorkKind
    expect(toggleKind({ staffing: [{}] }, old).staffing).toEqual([{ kindId: 'k' }, { certificationIds: [CLIMB], kindId: 'k' }])
  })
})
