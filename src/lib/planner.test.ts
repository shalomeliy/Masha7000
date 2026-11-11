import { describe, expect, it } from 'vitest'
import { autoAssign, busyCrew, busyText, candidateOrder, loadWarning, NO_WORKER, planShifts, weekPlanOrder, workerLoad, type PlanContext } from './planner'
import type { ShiftDefinition, ShiftRecord, Worker } from '../types/models'

const day: ShiftDefinition = {
  id: 'day',
  name: 'יום',
  startTime: '07:00',
  endTime: '16:00',
  requiredCertificationIds: [],
}
const night: ShiftDefinition = {
  ...day,
  id: 'night',
  name: 'לילה',
  endsNextDay: true,
}

const worker = (id: string, roleIds: string[] = [], certificationIds: string[] = []): Worker => ({
  id,
  firstName: id,
  lastName: '',
  certificationIds: [...roleIds, ...certificationIds],
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
const on = (...ids: string[]) => ids.map((workerId) => ({ workerId }))
const ctx = (workers: Worker[], records: ShiftRecord[] = []): PlanContext => ({
  workers,
  records,
  defs: [day, night],
})
const ids = (p: { crew: { workerId: string }[] }) => p.crew.map((c) => c.workerId)

// 2026-10-25 is a Sunday.
describe('autoAssign', () => {
  it('stars do not change the pick: the fairest worker comes first (the user, 2026-11-11)', () => {
    // "a" is the fairest pick; the manager gave him 2 stars in climbing and "b" has the full 5.
    const ws = [{ ...worker('a', ['climber']), certRatings: { climber: 2 } }, worker('b', ['climber'])]
    const busyB = [shift('x', '2026-10-26', { crew: on('b') })]
    expect(ids(autoAssign(shift('s', '2026-10-28'), [{ certificationIds: ['climber'] }], ctx(ws, busyB)))).toEqual(['a'])
    expect(ids(autoAssign(shift('s', '2026-10-28'), [{}], ctx(ws, busyB)))).toEqual(['a'])
  })

  it('never puts the same worker in two places of one shift', () => {
    const p = autoAssign(shift('s', '2026-10-28'), [{}, {}, {}], ctx([worker('a'), worker('b')]))
    expect(ids(p)).toEqual(['a', 'b'])
    expect(p.unfilled).toEqual([{}])
  })

  it('gives each place a worker with its role and certification; everyone holds the general role', () => {
    const ws = [worker('a'), worker('b', ['climber']), worker('c', ['climber'], ['h40'])]
    const p = autoAssign(shift('s', '2026-10-28'), [{ certificationIds: ['climber', 'h40'] }, { certificationIds: ['climber'] }, {}], ctx(ws))
    expect(p.crew).toEqual([
      { workerId: 'c' },
      { workerId: 'b' },
      { workerId: 'a' },
    ])
  })

  it('does not waste the only fitting worker on an easier place', () => {
    // "a" is the fairest pick, and the only climber: he must go to the climber place.
    const ws = [worker('a', ['climber']), worker('b')]
    const p = autoAssign(shift('s', '2026-10-28'), [{}, { certificationIds: ['climber'] }], ctx(ws, [shift('x', '2026-10-26', { crew: on('b') })]))
    expect(p.crew).toEqual([
      { workerId: 'b' },
      { workerId: 'a' },
    ])
  })

  it('picks whoever has the fewest shifts this week, urgent shifts included', () => {
    const records = [shift('x', '2026-10-26', { crew: on('a', 'b') }), shift('u', '2026-10-27', { urgent: true, crew: on('a') })]
    const p = autoAssign(shift('s', '2026-10-30'), [{}, {}], ctx([worker('a'), worker('b'), worker('c')], records))
    expect(ids(p)).toEqual(['c', 'b'])
  })

  it('only counts this week (Sunday to Saturday) for the weekly count', () => {
    const records = [shift('x', '2026-10-24', { crew: on('a') }), shift('y', '2026-10-25', { crew: on('b') })] // Saturday, Sunday
    const p = autoAssign(shift('s', '2026-10-28'), [{}], ctx([worker('a'), worker('b')], records))
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
    expect(ids(autoAssign(tonight, [{}], ctx([worker('a'), worker('b')], [...nights, ...days])))).toEqual(['b'])
    const alone = autoAssign(tonight, [{}], ctx([worker('a')], nights))
    expect(ids(alone)).toEqual(['a'])
    expect(loadWarning(workerLoad(worker('a'), tonight, ctx([], nights)))).toBe('כבר שובץ ל-2 לילות השבוע')
  })

  it('the night limit does not apply to a day shift', () => {
    const nights = [
      shift('n1', '2026-10-25', { shiftDefinitionId: 'night', crew: on('a') }),
      shift('n2', '2026-10-27', { shiftDefinitionId: 'night', crew: on('a') }),
    ]
    expect(workerLoad(worker('a'), shift('s', '2026-10-30'), ctx([], nights)).overNightLimit).toBe(false)
  })

  it('an urgent shift is a night job for the limit', () => {
    const records = [shift('n1', '2026-10-25', { urgent: true, crew: on('a') }), shift('n2', '2026-10-27', { shiftDefinitionId: 'night', crew: on('a') })]
    expect(workerLoad(worker('a'), shift('s', '2026-10-30', { shiftDefinitionId: 'night' }), ctx([], records)).overNightLimit).toBe(true)
  })

  it('prefers a worker who is not already working at the same time (a night job runs into the next day)', () => {
    const records = [
      shift('n', '2026-10-27', { shiftDefinitionId: 'night', crew: on('a') }),
      shift('x', '2026-10-26', { crew: on('b') }),
      shift('y', '2026-10-25', { crew: on('b') }),
    ]
    // The next day is taken for another night job.
    const nextNight = shift('s', '2026-10-28', { shiftDefinitionId: 'night' })
    const p = autoAssign(nextNight, [{}], ctx([worker('a'), worker('b')], records))
    expect(ids(p)).toEqual(['b'])
    expect(loadWarning(workerLoad(worker('a'), nextNight, ctx([], records)))).toBe('כבר בעבודה אחרת באותו זמן')
  })

  it('a day job the morning after a night job is allowed: the crew slept at a hotel', () => {
    const records = [shift('n', '2026-10-27', { shiftDefinitionId: 'night', crew: on('a') })]
    const nextDay = shift('s', '2026-10-28')
    expect(workerLoad(worker('a'), nextDay, ctx([], records)).busy).toBe(false)
    expect(loadWarning(workerLoad(worker('a'), nextDay, ctx([], records)))).toBeNull()
    // Saved the other way round: the night job sees the day job after it as no clash either.
    expect(workerLoad(worker('a'), records[0], ctx([], [{ ...nextDay, crew: on('a') }])).busy).toBe(false)
    // The night's own first day is still taken.
    expect(workerLoad(worker('a'), shift('t', '2026-10-27'), ctx([], records)).busy).toBe(true)
  })

  it('keeps workers the manager already put in, and fills only the empty places', () => {
    const s = shift('s', '2026-10-28', {
      crew: [{ workerId: 'b' }],
    })
    const p = autoAssign(s, [{}, { certificationIds: ['climber'] }], ctx([worker('a', ['climber']), worker('b', ['climber'])]))
    expect(p.crew).toEqual([
      { workerId: 'a' },
      { workerId: 'b' },
    ])
  })

  it('keeps a manager pick that fits no place, and does not count the shift being edited', () => {
    const s = shift('s', '2026-10-28', { crew: on('b') })
    const p = autoAssign(s, [{ certificationIds: ['climber'] }], ctx([worker('a', ['climber']), worker('b')], [s]))
    expect(p.crew).toEqual([
      { workerId: 'a' },
      { workerId: 'b' },
    ])
    expect(workerLoad(worker('b'), s, ctx([], [s])).week).toBe(0)
  })

  it('is deterministic: ties go by name, whatever the order of the list', () => {
    const ws = [worker('דני'), worker('אבי'), worker('גדי')]
    const a = autoAssign(shift('s', '2026-10-28'), [{}, {}], ctx(ws))
    const b = autoAssign(shift('s', '2026-10-28'), [{}, {}], ctx([...ws].reverse()))
    expect(ids(a)).toEqual(['אבי', 'גדי'])
    expect(b).toEqual(a)
  })

  it('breaks a weekly tie by the shifts of the past four weeks', () => {
    const records = [shift('old', '2026-10-14', { crew: on('a') })]
    expect(candidateOrder(shift('s', '2026-10-28'), ctx([worker('a'), worker('b')], records)).map((c) => c.worker.id)).toEqual(['b', 'a'])
  })
})

describe('constraints in autoAssign', () => {
  const off = (id: string, c: Partial<Worker['constraints'][number]>, roleIds: string[] = []): Worker => ({
    ...worker(id, roleIds),
    constraints: [{ id: `${id}-c`, when: 'dates', ...c }],
  })

  it('never picks a blocked worker, even the least loaded one, and says why the place is empty', () => {
    const records = [shift('x', '2026-10-26', { crew: on('b') })]
    const p = autoAssign(shift('s', '2026-10-28'), [{}, {}], ctx([off('a', { from: '2026-10-27', to: '2026-10-29' }), worker('b')], records))
    expect(ids(p)).toEqual(['b'])
    expect(p.why).toEqual(['לא זמינים: a (לא זמין 27.10 עד 29.10)'])
  })

  it('a night job is blocked by a day off on its second day, a day shift is not', () => {
    const w = off('a', { from: '2026-10-29', to: '2026-10-29' })
    expect(ids(autoAssign(shift('s', '2026-10-28', { shiftDefinitionId: 'night' }), [{}], ctx([w])))).toEqual([])
    expect(ids(autoAssign(shift('s', '2026-10-28'), [{}], ctx([w])))).toEqual(['a'])
  })

  it('nights-only on a weekday blocks only a night job starting that day', () => {
    const w = off('a', { when: 'weekdays', weekdays: [3], nightsOnly: true }) // Wednesday
    expect(ids(autoAssign(shift('s', '2026-10-28', { shiftDefinitionId: 'night' }), [{}], ctx([w])))).toEqual([])
    expect(ids(autoAssign(shift('s', '2026-10-28'), [{}], ctx([w])))).toEqual(['a'])
    expect(ids(autoAssign(shift('s', '2026-10-27', { shiftDefinitionId: 'night' }), [{}], ctx([w])))).toEqual(['a'])
  })

  it('keeps a blocked worker the manager put in by hand, with a warning', () => {
    const w = off('a', { when: 'always', nightsOnly: true, note: 'בעיה בגב' })
    const s = shift('s', '2026-10-28', { shiftDefinitionId: 'night', crew: on('a') })
    expect(ids(autoAssign(s, [{}], ctx([w])))).toEqual(['a'])
    expect(loadWarning(workerLoad(w, s, ctx([w])))).toBe('בלי לילות בכלל (בעיה בגב)')
  })

  it('a place that needs several certifications and roles takes only a worker who holds them all', () => {
    const slot = { certificationIds: ['climber', 'manager', 'weld', 'h40'] }
    const some = worker('a', ['climber', 'manager'], ['weld'])
    const all = worker('b', ['climber', 'manager'], ['weld', 'h40'])
    expect(ids(autoAssign(shift('s', '2026-10-28'), [slot], ctx([some, all])))).toEqual(['b'])
    expect(autoAssign(shift('s', '2026-10-28'), [slot], ctx([some])).why).toEqual([NO_WORKER])
  })

  it('tells a missing role apart from a crew that already holds everyone', () => {
    const p = autoAssign(shift('s', '2026-10-28'), [{}, {}, { certificationIds: ['climber'] }], ctx([worker('a')]))
    expect(p.why).toEqual(['כל המתאימים כבר בעבודה הזו', NO_WORKER])
  })
})

describe('planShifts', () => {
  const ws = [worker('a'), worker('b'), worker('c')]
  const two = [{}, {}]

  it('gives the same crews as "שבץ" and save on each shift, one by one, in the same order', () => {
    const shifts = [shift('s1', '2026-10-27'), shift('s2', '2026-10-26', { shiftDefinitionId: 'night' }), shift('s3', '2026-10-26')]
    const plan = planShifts(shifts, () => two, ctx(ws, shifts))
    let records = shifts
    for (const s of weekPlanOrder(shifts, () => two, [day, night])) {
      const p = autoAssign(s, two, ctx(ws, records))
      records = records.map((r) => (r.id === s.id ? { ...r, crew: p.crew } : r))
    }
    expect(plan.map((i) => [i.shift.id, ids(i.shift)])).toEqual(weekPlanOrder(records, () => two, [day, night]).map((r) => [r.id, ids(r)]))
  })

  it('staffs night jobs first on a date, and never puts a worker in two shifts at once', () => {
    const shifts = [shift('d', '2026-10-26'), shift('n', '2026-10-26', { shiftDefinitionId: 'night' })]
    const plan = planShifts(shifts, () => [{}], ctx(ws, shifts))
    expect(plan.map((i) => i.shift.id)).toEqual(['n', 'd'])
    expect(ids(plan[0].shift)).not.toEqual(ids(plan[1].shift))
  })

  it('keeps the manager\'s picks and lists only the workers it added', () => {
    const s = shift('s', '2026-10-27', { crew: on('c') })
    const [item] = planShifts([s], () => two, ctx(ws, [s]))
    expect(ids(item.shift)).toContain('c')
    expect(item.added.map((c) => c.workerId)).toEqual(['a'])
  })

  it('spreads the week: three one-person shifts go to three different workers', () => {
    const shifts = ['2026-10-26', '2026-10-27', '2026-10-28'].map((d, i) => shift(`s${i}`, d))
    const plan = planShifts(shifts, () => [{}], ctx(ws, shifts))
    expect(new Set(plan.flatMap((i) => ids(i.shift))).size).toBe(3)
  })

  it('reports places nobody can fill', () => {
    const s = shift('s', '2026-10-27')
    const [item] = planShifts([s], () => [{ certificationIds: ['climber'] }], ctx(ws, [s]))
    expect(item.unfilled).toEqual([{ certificationIds: ['climber'] }])
    expect(item.why).toEqual([NO_WORKER])
  })
})

describe('never two shifts at the same time', () => {
  it('"שבץ" leaves a place empty rather than pick a worker already in another shift then', () => {
    const records = [shift('n', '2026-10-27', { shiftDefinitionId: 'night', crew: on('a') })]
    const p = autoAssign(shift('s', '2026-10-27'), [{}], ctx([worker('a')], records))
    expect(p.crew).toEqual([])
    expect(p.why).toEqual(['בעבודה אחרת באותו זמן: a'])
  })

  it('busyCrew names the crew member and the other shift; a shift on another day is not a clash', () => {
    const n = shift('n', '2026-10-27', { shiftDefinitionId: 'night', crew: on('a') })
    const d = shift('d', '2026-10-27', { crew: on('a', 'b') })
    const busy = busyCrew(d, [worker('a'), worker('b')], [n, d], [day, night])
    expect(busy.map((b) => [b.worker.id, b.other.id])).toEqual([['a', 'n']])
    expect(busyText(busy)).toBe('a כבר בעבודה ביום שלישי 27.10 (חיפה)')
    expect(busyCrew({ ...d, date: '2026-10-29' }, [worker('a')], [n, d], [day, night])).toEqual([])
  })
})

describe('worker status', () => {
  const slot = [{}]
  it('never picks an inactive worker, nor lists them', () => {
    const c = ctx([{ ...worker('a'), status: 'inactive' }, worker('b')])
    expect(ids(autoAssign(shift('s', '2026-10-28'), slot, c))).toEqual(['b'])
    expect(candidateOrder(shift('s', '2026-10-28'), c).map((x) => x.worker.id)).toEqual(['b'])
  })

  it('a sick worker is blocked up to and including the last sick day, then picked again', () => {
    const sick: Worker = { ...worker('a'), status: 'sick', sickUntil: '2026-10-28' }
    const p = autoAssign(shift('s', '2026-10-28'), slot, ctx([sick]))
    expect(p.unfilled).toEqual(slot)
    expect(p.why[0]).toContain('במחלה עד 28.10')
    expect(ids(autoAssign(shift('s', '2026-10-29'), slot, ctx([sick])))).toEqual(['a'])
  })

  it('a night job that ends on a sick day is blocked too', () => {
    const sick: Worker = { ...worker('a'), status: 'sick', sickUntil: '2026-10-29' }
    expect(autoAssign(shift('s', '2026-10-28', { shiftDefinitionId: 'night' }), slot, ctx([sick])).unfilled).toEqual(slot)
  })
})
