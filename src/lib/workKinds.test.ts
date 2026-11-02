import { describe, expect, it } from 'vitest'
import { emptyPlaces } from './gaps'
import { autoAssign, type PlanContext } from './planner'
import { starterKinds, toggleKind } from './workKinds'
import type { ShiftDefinition, ShiftRecord, StaffSlot, Worker, WorkKind } from '../types/models'

const G = 'general'
const MGR = 'mgr'
const CLIMB = 'climb'
const WELD = 'weld'

const day: ShiftDefinition = { id: 'day', name: 'יום', startTime: '07:00', endTime: '16:00', requiredRoleIds: [], requiredCertificationIds: [] }
const worker = (id: string, roleIds: string[] = [], certificationIds: string[] = []): Worker => ({
  id,
  firstName: id,
  lastName: '',
  roleIds,
  certificationIds,
  constraints: [],
})
const climbing: WorkKind = { id: 'k-climb', name: 'טיפוס', staffing: [{ roleId: MGR }, { roleId: CLIMB, altRoleIds: [MGR] }, { roleId: CLIMB, altRoleIds: [MGR] }] }
const welding: WorkKind = { id: 'k-weld', name: 'ריתוך', staffing: [{ roleId: G, certificationId: WELD }] }
const job = (staffing: StaffSlot[], crew: ShiftRecord['crew'] = []): ShiftRecord => ({
  id: 'j',
  date: '2026-11-03',
  shiftDefinitionId: 'day',
  location: 'חיפה',
  jobDescription: '',
  crew,
  staffing,
})
const ctx = (workers: Worker[]): PlanContext => ({ workers, records: [], defs: [day], generalId: G })
const both = () => toggleKind(toggleKind({ staffing: [{ roleId: G }] }, climbing, G), welding, G)

describe('toggleKind', () => {
  it('replaces the default single place with the kind places, and combines kinds', () => {
    const one = toggleKind({ staffing: [{ roleId: G }] }, climbing, G)
    expect(one.workKindIds).toEqual(['k-climb'])
    expect(one.staffing).toHaveLength(3)
    expect(one.staffing.every((s) => s.kindId === 'k-climb')).toBe(true)
    expect(both().staffing).toHaveLength(4)
  })

  it('keeps places added by hand and removes only the kind places', () => {
    const start = { staffing: [{ roleId: CLIMB }, { roleId: G }] }
    const on = toggleKind(start, welding, G)
    expect(on.staffing).toHaveLength(3)
    const off = toggleKind(on, welding, G)
    expect(off.staffing).toEqual(start.staffing)
    expect(off.workKindIds).toEqual([])
  })

  it('replaces several bare "כללי" places too, so a second tap never piles places up', () => {
    const three = { staffing: [{ roleId: G }, { roleId: G }, { roleId: G }] }
    const on = toggleKind(toggleKind(three, welding, G), climbing, G)
    expect(on.staffing).toHaveLength(4)
    expect(on.staffing.every((s) => s.kindId)).toBe(true)
    expect(toggleKind(toggleKind(on, welding, G), climbing, G).staffing).toEqual([{ roleId: G }])
  })

  it('leaves one "כללי" place when the last kind goes', () => {
    expect(toggleKind(toggleKind({ staffing: [{ roleId: G }] }, welding, G), welding, G).staffing).toEqual([{ roleId: G }])
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

  it('a manager fills a climber place, and two places of one kind never share a worker', () => {
    const { staffing } = toggleKind({ staffing: [{ roleId: G }] }, climbing, G)
    const plan = autoAssign(job(staffing), staffing, ctx([worker('m1', [MGR]), worker('m2', [MGR]), worker('m3', [MGR], [WELD])]))
    expect(plan.unfilled).toEqual([])
    expect(plan.crew).toHaveLength(3)
    expect(plan.crew.filter((c) => c.roleId === MGR)).toHaveLength(3)
  })

  it('a welder with no climbing role is added as a fourth person', () => {
    const { staffing } = both()
    const workers = [worker('a', [MGR]), worker('b', [CLIMB]), worker('c', [CLIMB]), worker('w', [], [WELD])]
    const plan = autoAssign(job(staffing), staffing, ctx(workers))
    expect(plan.unfilled).toEqual([])
    expect(plan.crew).toHaveLength(4)
  })

  it('a hand-picked climber who welds also counts for the welding place', () => {
    const { staffing } = both()
    const workers = [worker('a', [MGR]), worker('b', [CLIMB]), worker('d', [CLIMB], [WELD])]
    const crew = [{ workerId: 'a', roleId: MGR }, { workerId: 'b', roleId: CLIMB }, { workerId: 'd', roleId: CLIMB }]
    expect(emptyPlaces(job(staffing, crew), staffing, workers, G)).toEqual([])
    expect(autoAssign(job(staffing, crew), staffing, ctx(workers)).crew).toHaveLength(3)
  })
})

describe('starterKinds', () => {
  it('adds the missing roles and certification', () => {
    const r = starterKinds([{ id: G, name: 'כללי' }], [])
    expect(r.roles.map((x) => x.name)).toEqual(['מנהל טיפוס', 'מטפס'])
    expect(r.certs.map((x) => x.name)).toEqual(['רתך'])
    expect(r.kinds.map((k) => [k.name, k.staffing.length])).toEqual([
      ['טיפוס', 3],
      ['ריתוך', 1],
    ])
  })

  it('uses an existing "טפסן" as the climber', () => {
    const r = starterKinds([{ id: G, name: 'כללי' }, { id: 't', name: 'טפסן' }], [{ id: 'c', name: 'רתך' }])
    expect(r.roles.map((x) => x.name)).toEqual(['מנהל טיפוס'])
    expect(r.certs).toEqual([])
    expect(r.kinds[0].staffing[1].roleId).toBe('t')
    expect(r.kinds[1].staffing[0].certificationIds).toEqual(['c'])
  })
})
