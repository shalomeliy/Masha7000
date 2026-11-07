import { describe, expect, it } from 'vitest'
import { workerAgenda } from './workerAgenda'
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
  it("lists only this worker's jobs from today on, a night job until the next day", () => {
    const shifts = [shift('past', '2026-11-05', ['w']), shift('other', '2026-11-08', ['x']), shift('n', '2026-11-06', ['w'], 'night'), shift('soon', '2026-11-09', ['w'])]
    const { dated } = workerAgenda(w(), shifts, defs, TODAY)
    expect(dated.map((i) => i.key)).toEqual(['job-n', 'job-soon'])
    expect(dated[0]).toMatchObject({ date: '2026-11-06', endDate: '2026-11-07' })
  })

  it('shows sickness, vacations and picked days in date order; past ones are left out', () => {
    const worker = w({
      status: 'sick',
      sickUntil: '2026-11-08',
      constraints: [
        { id: 'old', when: 'dates', from: '2026-11-01', to: '2026-11-02', kind: 'vacation' },
        { id: 'vac', when: 'dates', from: '2026-11-20', to: '2026-11-25', kind: 'vacation' },
        { id: 'day', when: 'dates', from: '2026-11-10', to: '2026-11-10' },
      ],
    })
    const { dated } = workerAgenda(worker, [shift('s', '2026-11-10', ['w'])], defs, TODAY)
    expect(dated.map((i) => i.key)).toEqual(['sick', 'c-day', 'job-s', 'c-vac'])
  })

  it('an absence going on today sorts as today; weekly ones are listed apart', () => {
    const worker = w({
      constraints: [
        { id: 'res', when: 'dates', from: '2026-11-01', to: '2026-11-12', kind: 'reserve' },
        { id: 'study', when: 'weekdays', weekdays: [2], kind: 'study' },
        { id: 'ended', when: 'weekdays', weekdays: [3], to: '2026-11-01' },
      ],
    })
    const { dated, weekly } = workerAgenda(worker, [], defs, TODAY)
    expect(dated).toMatchObject([{ key: 'c-res', date: TODAY, endDate: '2026-11-12' }])
    expect(weekly.map((c) => c.id)).toEqual(['study'])
  })
})
