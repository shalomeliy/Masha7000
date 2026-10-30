import { describe, expect, it } from 'vitest'
import { emptyPlaces, gapCounts, shiftGaps, type GapContext } from './gaps'
import { autoAssign } from './planner'
import type { ShiftDefinition, ShiftRecord, StaffSlot, Worker } from '../types/models'

const day: ShiftDefinition = { id: 'day', name: 'יום', startTime: '07:00', endTime: '16:00', requiredRoleIds: [], requiredCertificationIds: [] }
const night: ShiftDefinition = { ...day, id: 'night', name: 'לילה', endsNextDay: true }
const G = 'general'
const roles = [
  { id: G, name: 'כללי' },
  { id: 'climber', name: 'טפסן' },
]
const certifications = [{ id: 'h40', name: "אנטנה עד 40מ'" }]

const worker = (id: string, roleIds: string[] = [], certificationIds: string[] = []): Worker => ({
  id,
  firstName: id,
  lastName: '',
  roleIds,
  certificationIds,
  constraints: [],
})
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

// 2026-10-25 is a Sunday.
describe('shiftGaps', () => {
  it('a shift needing 2 טפסן with 1 is missing one טפסן', () => {
    const s = shift('s', '2026-10-27', { staffing: climbers(2), crew: [{ workerId: 'a', roleId: 'climber' }] })
    const g = shiftGaps(s, ctx([worker('a', ['climber']), worker('b', ['climber'])], [s]))
    expect(g.missing.map((m) => m.slot)).toEqual([{ roleId: 'climber' }])
    expect(g.missing[0].why).toBeUndefined()
    expect(g.kinds).toEqual(['missing'])
  })

  it('a crew member without the place\'s certification leaves it missing, with the reason', () => {
    const s = shift('s', '2026-10-27', { staffing: [{ roleId: 'climber', certificationId: 'h40' }], crew: [{ workerId: 'a', roleId: 'climber' }] })
    const g = shiftGaps(s, ctx([worker('a', ['climber'])], [s]))
    expect(g.missing).toEqual([{ slot: { roleId: 'climber', certificationId: 'h40' }, why: 'אין עובד עם התפקיד וההסמכה האלה' }])
  })

  it('a shift fully staffed by "שבץ" is never missing', () => {
    const ws = [worker('a'), worker('b', ['climber']), worker('c', ['climber'], ['h40']), worker('d', ['climber'])]
    const staffing: StaffSlot[] = [{ roleId: G }, { roleId: 'climber' }, { roleId: 'climber', certificationId: 'h40' }]
    const s = shift('s', '2026-10-27', { staffing })
    const plan = autoAssign(s, staffing, { workers: ws, records: [], defs: [day, night], generalId: G })
    const staffed = { ...s, crew: plan.crew }
    expect(plan.unfilled).toEqual([])
    expect(shiftGaps(staffed, ctx(ws, [staffed])).kinds).toEqual([])
  })

  it('the crew\'s order never makes a place look empty', () => {
    const ws = [worker('a', ['climber'], ['h40']), worker('b', ['climber'])]
    const staffing: StaffSlot[] = [{ roleId: 'climber' }, { roleId: 'climber', certificationId: 'h40' }]
    const s = shift('s', '2026-10-27', {
      staffing,
      crew: [
        { workerId: 'a', roleId: 'climber' },
        { workerId: 'b', roleId: 'climber' },
      ],
    })
    expect(emptyPlaces(s, staffing, ws, G)).toEqual([])
  })

  it('no staffing means one "כללי", which any crew member fills', () => {
    const empty = shift('s', '2026-10-27')
    expect(shiftGaps(empty, ctx([worker('a')], [empty])).missing.map((m) => m.slot)).toEqual([{ roleId: G }])
    const s = shift('s', '2026-10-27', { crew: [{ workerId: 'a', roleId: 'climber' }] })
    expect(shiftGaps(s, ctx([worker('a', ['climber'])], [s])).kinds).toEqual([])
  })

  it('a worker in a Monday night job and a Tuesday day shift is in both at once', () => {
    const n = shift('n', '2026-10-26', { shiftDefinitionId: 'night', crew: [{ workerId: 'a', roleId: G }] })
    const d = shift('d', '2026-10-27', { crew: [{ workerId: 'a', roleId: G }] })
    const g = shiftGaps(d, ctx([worker('a')], [n, d]))
    expect(g.doubleIds).toEqual(['a'])
    expect(g.kinds).toEqual(['double'])
  })

  it('a third night job in the week is a night warning, not a missing place', () => {
    const nights = ['2026-10-25', '2026-10-27', '2026-10-29'].map((date, i) =>
      shift(`n${i}`, date, { shiftDefinitionId: 'night', crew: [{ workerId: 'a', roleId: G }] }),
    )
    const g = shiftGaps(nights[2], ctx([worker('a')], nights))
    expect(g.nightIds).toEqual(['a'])
    expect(g.kinds).toEqual(['nights'])
  })

  it('a constraint on the crew is a conflict, and the reason names who is not available', () => {
    const off: Worker = { ...worker('b'), constraints: [{ id: 'c', when: 'dates', from: '2026-10-27', to: '2026-10-27' }] }
    const s = shift('s', '2026-10-27', { staffing: [{ roleId: G }, { roleId: G }], crew: [{ workerId: 'b', roleId: G }] })
    const g = shiftGaps(s, ctx([off], [s]))
    expect(g.blockedIds).toEqual(['b'])
    expect(g.kinds).toEqual(['missing', 'blocked'])
    expect(g.missing[0].why).toBe('כל המתאימים כבר במשמרת הזו')
    const t = shift('t', '2026-10-27', { staffing: [{ roleId: G }] })
    expect(shiftGaps(t, ctx([off], [t])).missing[0].why).toMatch(/^לא זמינים: b/)
  })

  it('a closed night job is never checked', () => {
    const s = shift('s', '2026-10-27', { shiftDefinitionId: 'night', closure: { outcome: 'done', reasonIds: [], closedAt: '2026-10-28T10:00:00Z' } })
    expect(shiftGaps(s, ctx([], [s])).kinds).toEqual([])
  })
})

describe('gapCounts', () => {
  it('counts each shift once per kind', () => {
    const counts = gapCounts([
      { missing: [], doubleIds: [], nightIds: [], blockedIds: [], kinds: ['missing', 'blocked'] },
      { missing: [], doubleIds: [], nightIds: [], blockedIds: [], kinds: ['missing'] },
      { missing: [], doubleIds: [], nightIds: [], blockedIds: [], kinds: [] },
    ])
    expect(counts).toEqual({ missing: 2, blocked: 1, double: 0, nights: 0 })
  })
})
