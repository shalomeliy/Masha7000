import { describe, expect, it } from 'vitest'
import { normalizeConstraint } from './constraints'
import { agendaConstraintIds, workerAgenda } from './workerAgenda'
import { workerState } from './workerState'
import type { ShiftDefinition, ShiftRecord, Worker } from '../types/models'

const TODAY = '2026-11-07'
const w = (over: Partial<Worker> = {}): Worker => ({ id: 'w', firstName: 'דני', lastName: 'לוי', roleIds: [], certificationIds: [], constraints: [], ...over })
const defs: ShiftDefinition[] = [
  { id: 'day', name: 'יום', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00' },
  { id: 'night', name: 'לילה', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00', endsNextDay: true },
]
const shift = (id: string, date: string, crew: string[], def = 'day'): ShiftRecord => ({
  id, date, shiftDefinitionId: def, location: 'אילת', jobDescription: 'אנטנה', crew: crew.map((workerId) => ({ workerId, roleId: 'r' })), staffing: [],
})

describe('workerAgenda', () => {
  it("lists only this worker's jobs in the next 3 days, a night job from yesterday until today", () => {
    const shifts = [shift('past', '2026-11-05', ['w']), shift('other', '2026-11-08', ['x']), shift('n', '2026-11-06', ['w'], 'night'), shift('soon', '2026-11-09', ['w']), shift('later', '2026-11-10', ['w'])]
    const items = workerAgenda(w(), shifts, defs, TODAY)
    expect(items.map((i) => i.key)).toEqual(['job-n', 'job-soon'])
    expect(items[0]).toMatchObject({ date: '2026-11-06', endDate: '2026-11-07' })
  })

  it('shows sickness, an absence going on today (as today) and a day off, in order; past and later ones are left out', () => {
    const worker = w({
      status: 'sick',
      sickUntil: '2026-11-08',
      constraints: [
        { id: 'old', when: 'dates', from: '2026-11-01', to: '2026-11-02', kind: 'vacation' },
        { id: 'res', when: 'dates', from: '2026-11-01', to: '2026-11-12', kind: 'reserve' },
        { id: 'day', when: 'dates', from: '2026-11-09', to: '2026-11-09' },
        { id: 'vac', when: 'dates', from: '2026-11-20', to: '2026-11-25', kind: 'vacation' },
        { id: 'study', when: 'weekdays', weekdays: [0], kind: 'study' },
      ],
    })
    const items = workerAgenda(worker, [shift('s', '2026-11-09', ['w'])], defs, TODAY)
    expect(items.map((i) => i.key)).toEqual(['sick', 'c-res', 'c-day', 'job-s'])
    expect(agendaConstraintIds(items)).toEqual(['res', 'day'])
  })

  it('a WhatsApp guess stays in the constraints list', () => {
    const items = workerAgenda(w({ constraints: [{ id: 'g', when: 'dates', from: TODAY, to: TODAY, guess: true }] }), [], defs, TODAY)
    expect(items).toHaveLength(1)
    expect(agendaConstraintIds(items)).toEqual([])
  })
})

describe('sickness ahead', () => {
  it('a day saved with the note "מחלה" is read as sickness: red in the calendar, the state on that day', () => {
    const c = normalizeConstraint({ id: 's', when: 'dates', from: '2026-11-08', to: '2026-11-08', note: 'מחלה' })
    expect(c.kind).toBe('sick')
    const worker = w({ constraints: [c] })
    expect(workerAgenda(worker, [], defs, TODAY)).toMatchObject([{ key: 'c-s', date: '2026-11-08', sick: true }])
    expect(workerState(worker, TODAY).id).toBe('fit')
    expect(workerState(worker, '2026-11-08')).toEqual({ id: 'sick', label: 'במחלה' })
  })
})
