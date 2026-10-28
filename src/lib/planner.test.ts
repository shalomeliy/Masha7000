import { describe, expect, it } from 'vitest'
import { autoAssign, candidateOrder, loadWarning, workerLoad, type PlanContext } from './planner'
import type { ShiftDefinition, ShiftRecord, Worker } from '../types/models'

const day: ShiftDefinition = {
  id: 'day',
  name: 'יום',
  startTime: '07:00',
  endTime: '16:00',
  requiredRoleIds: [],
  requiredCertificationIds: [],
}
const night: ShiftDefinition = {
  ...day,
  id: 'night',
  name: 'לילה',
  endsNextDay: true,
}
const G = 'general'

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
const on = (...ids: string[]) => ids.map((workerId) => ({ workerId, roleId: G }))
const ctx = (workers: Worker[], records: ShiftRecord[] = []): PlanContext => ({
  workers,
  records,
  defs: [day, night],
  generalId: G,
})
const ids = (p: { crew: { workerId: string }[] }) => p.crew.map((c) => c.workerId)

// 2026-10-25 is a Sunday.
describe('autoAssign', () => {
  it('never puts the same worker in two places of one shift', () => {
    const p = autoAssign(shift('s', '2026-10-28'), [{ roleId: G }, { roleId: G }, { roleId: G }], ctx([worker('a'), worker('b')]))
    expect(ids(p)).toEqual(['a', 'b'])
    expect(p.unfilled).toEqual([{ roleId: G }])
  })

  it('gives each place a worker with its role and certification; everyone holds the general role', () => {
    const ws = [worker('a'), worker('b', ['climber']), worker('c', ['climber'], ['h40'])]
    const p = autoAssign(shift('s', '2026-10-28'), [{ roleId: 'climber', certificationId: 'h40' }, { roleId: 'climber' }, { roleId: G }], ctx(ws))
    expect(p.crew).toEqual([
      { workerId: 'c', roleId: 'climber' },
      { workerId: 'b', roleId: 'climber' },
      { workerId: 'a', roleId: G },
    ])
  })

  it('does not waste the only fitting worker on an easier place', () => {
    // "a" is the fairest pick, and the only climber: he must go to the climber place.
    const ws = [worker('a', ['climber']), worker('b')]
    const p = autoAssign(shift('s', '2026-10-28'), [{ roleId: G }, { roleId: 'climber' }], ctx(ws, [shift('x', '2026-10-26', { crew: on('b') })]))
    expect(p.crew).toEqual([
      { workerId: 'b', roleId: G },
      { workerId: 'a', roleId: 'climber' },
    ])
  })

  it('picks whoever has the fewest shifts this week, urgent shifts included', () => {
    const records = [shift('x', '2026-10-26', { crew: on('a', 'b') }), shift('u', '2026-10-27', { urgent: true, crew: on('a') })]
    const p = autoAssign(shift('s', '2026-10-30'), [{ roleId: G }, { roleId: G }], ctx([worker('a'), worker('b'), worker('c')], records))
    expect(ids(p)).toEqual(['c', 'b'])
  })

  it('only counts this week (Sunday to Saturday) for the weekly count', () => {
    const records = [shift('x', '2026-10-24', { crew: on('a') }), shift('y', '2026-10-25', { crew: on('b') })] // Saturday, Sunday
    const p = autoAssign(shift('s', '2026-10-28'), [{ roleId: G }], ctx([worker('a'), worker('b')], records))
    expect(ids(p)).toEqual(['a'])
  })

  it('avoids a third night in the week, but still uses that worker when nobody else fits', () => {
    const nights = [
      shift('n1', '2026-10-25', { shiftDefinitionId: 'night', crew: on('a') }),
      shift('n2', '2026-10-27', { shiftDefinitionId: 'night', crew: on('a') }),
    ]
    const days = [shift('d1', '2026-10-26', { crew: on('b') }), shift('d2', '2026-10-27', { crew: on('b') }), shift('d3', '2026-10-28', { crew: on('b') })]
    const tonight = shift('s', '2026-10-30', { shiftDefinitionId: 'night' })
    // b has more shifts, but a would be over the night limit.
    expect(ids(autoAssign(tonight, [{ roleId: G }], ctx([worker('a'), worker('b')], [...nights, ...days])))).toEqual(['b'])
    const alone = autoAssign(tonight, [{ roleId: G }], ctx([worker('a')], nights))
    expect(ids(alone)).toEqual(['a'])
    expect(loadWarning(workerLoad('a', tonight, ctx([], nights)))).toBe('כבר שובץ ל-2 לילות השבוע')
  })

  it('the night limit does not apply to a day shift', () => {
    const nights = [
      shift('n1', '2026-10-25', { shiftDefinitionId: 'night', crew: on('a') }),
      shift('n2', '2026-10-27', { shiftDefinitionId: 'night', crew: on('a') }),
    ]
    expect(workerLoad('a', shift('s', '2026-10-30'), ctx([], nights)).overNightLimit).toBe(false)
  })

  it('an urgent shift is a night job for the limit', () => {
    const records = [shift('n1', '2026-10-25', { urgent: true, crew: on('a') }), shift('n2', '2026-10-27', { shiftDefinitionId: 'night', crew: on('a') })]
    expect(workerLoad('a', shift('s', '2026-10-30', { shiftDefinitionId: 'night' }), ctx([], records)).overNightLimit).toBe(true)
  })

  it('prefers a worker who is not already working at the same time (a night job runs into the next day)', () => {
    const records = [
      shift('n', '2026-10-27', { shiftDefinitionId: 'night', crew: on('a') }),
      shift('x', '2026-10-26', { crew: on('b') }),
      shift('y', '2026-10-25', { crew: on('b') }),
    ]
    const p = autoAssign(shift('s', '2026-10-28'), [{ roleId: G }], ctx([worker('a'), worker('b')], records))
    expect(ids(p)).toEqual(['b'])
    expect(loadWarning(workerLoad('a', shift('s', '2026-10-28'), ctx([], records)))).toBe('כבר במשמרת אחרת באותו זמן')
  })

  it('keeps workers the manager already put in, and fills only the empty places', () => {
    const s = shift('s', '2026-10-28', {
      crew: [{ workerId: 'b', roleId: 'climber' }],
    })
    const p = autoAssign(s, [{ roleId: G }, { roleId: 'climber' }], ctx([worker('a', ['climber']), worker('b', ['climber'])]))
    expect(p.crew).toEqual([
      { workerId: 'a', roleId: G },
      { workerId: 'b', roleId: 'climber' },
    ])
  })

  it('keeps a manager pick that fits no place, and does not count the shift being edited', () => {
    const s = shift('s', '2026-10-28', { crew: on('b') })
    const p = autoAssign(s, [{ roleId: 'climber' }], ctx([worker('a', ['climber']), worker('b')], [s]))
    expect(p.crew).toEqual([
      { workerId: 'a', roleId: 'climber' },
      { workerId: 'b', roleId: G },
    ])
    expect(workerLoad('b', s, ctx([], [s])).week).toBe(0)
  })

  it('is deterministic: ties go by name, whatever the order of the list', () => {
    const ws = [worker('דני'), worker('אבי'), worker('גדי')]
    const a = autoAssign(shift('s', '2026-10-28'), [{ roleId: G }, { roleId: G }], ctx(ws))
    const b = autoAssign(shift('s', '2026-10-28'), [{ roleId: G }, { roleId: G }], ctx([...ws].reverse()))
    expect(ids(a)).toEqual(['אבי', 'גדי'])
    expect(b).toEqual(a)
  })

  it('breaks a weekly tie by the shifts of the past four weeks', () => {
    const records = [shift('old', '2026-10-14', { crew: on('a') })]
    expect(candidateOrder(shift('s', '2026-10-28'), ctx([worker('a'), worker('b')], records)).map((c) => c.worker.id)).toEqual(['b', 'a'])
  })
})
