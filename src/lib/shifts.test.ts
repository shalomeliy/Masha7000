import { describe, expect, it } from 'vitest'
import { addDays, applyClosure, closureError, isNightShift, isWaiting, pendingAfterShiftSave, shiftRecordError, sortShifts, urgentShift, weekOf, weekShiftCount } from './shifts'
import type { ShiftClosure, ShiftDefinition, ShiftRecord, Worker } from '../types/models'

const day: ShiftDefinition = { id: 'day', name: 'יום', startTime: '07:00', endTime: '16:00', requiredRoleIds: [], requiredCertificationIds: [] }
const night: ShiftDefinition = { ...day, id: 'night', name: 'לילה', endsNextDay: true }
const defs = [day, night]

const worker = (id: string, roleIds: string[] = ['climber']): Worker => ({ id, firstName: id, lastName: '', roleIds, certificationIds: [], constraints: [] })
const shift = (over: Partial<ShiftRecord> = {}): ShiftRecord => ({
  id: 's1',
  date: '2026-10-28',
  shiftDefinitionId: 'night',
  location: 'חיפה',
  jobDescription: 'התקנת אנטנה',
  crew: [],
  ...over,
})

describe('weekOf', () => {
  it('runs Sunday to Saturday, so Saturday belongs to the week that started on Sunday', () => {
    expect(weekOf('2026-10-28')).toMatchObject({ start: '2026-10-25', end: '2026-10-31' }) // Wednesday
    expect(weekOf('2026-10-31').start).toBe('2026-10-25') // Saturday
    expect(weekOf('2026-11-01').start).toBe('2026-11-01') // Sunday starts a new week
  })
  it('adds days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('urgentShift', () => {
  it('opens today at the current minute, on a Saturday too, and ends tomorrow at 16:00', () => {
    const s = urgentShift(new Date(2026, 9, 31, 22, 10), defs)
    expect(s).toMatchObject({ date: '2026-10-31', startTime: '22:10', endDate: '2026-11-01', endTime: '16:00', urgent: true, shiftDefinitionId: 'night' })
  })
  it('counts as a night job, so it can be closed', () => {
    expect(isNightShift(urgentShift(new Date(), []), [])).toBe(true)
    expect(isNightShift(shift({ shiftDefinitionId: 'day' }), defs)).toBe(false)
    expect(isNightShift(shift(), defs)).toBe(true)
  })
})

describe('shiftRecordError', () => {
  const workers = [worker('a'), worker('b', [])]
  it('needs a shift type and a place or a job', () => {
    expect(shiftRecordError(shift({ shiftDefinitionId: undefined }), workers)).toBe('צריך לבחור סוג משמרת')
    expect(shiftRecordError(shift({ location: ' ', jobDescription: '' }), workers)).toBe('צריך למלא מיקום או מהות עבודה')
    expect(shiftRecordError(shift({ location: '' }), workers)).toBeNull()
  })
  it('rejects an impossible date', () => {
    expect(shiftRecordError(shift({ date: '2026-02-30' }), workers)).toBe('התאריך הזה לא קיים ביומן')
  })
  it('checks the crew: no worker twice, and a role the worker holds', () => {
    expect(shiftRecordError(shift({ crew: [{ workerId: 'a', roleId: 'climber' }, { workerId: 'a', roleId: 'climber' }] }), workers)).toBe('אותו עובד מופיע פעמיים במשמרת')
    expect(shiftRecordError(shift({ crew: [{ workerId: 'a', roleId: 'electrician' }] }), workers)).toBe('צריך לבחור תפקיד לa')
    expect(shiftRecordError(shift({ crew: [{ workerId: 'b', roleId: '' }] }), workers)).toBeNull()
  })
  it('an urgent shift must end after it starts', () => {
    const u = urgentShift(new Date(2026, 9, 28, 22, 0), defs)
    u.location = 'חיפה'
    expect(shiftRecordError(u, workers)).toBeNull()
    expect(shiftRecordError({ ...u, endDate: u.date, endTime: '21:00' }, workers)).toBe('שעת הסיום צריכה להיות אחרי שעת ההתחלה')
    expect(shiftRecordError({ ...u, endDate: '2026-10-27' }, workers)).toMatch(/^תאריך סיום:/)
  })
})

describe('weekShiftCount', () => {
  const records = [
    shift({ id: '1', date: '2026-10-25', crew: [{ workerId: 'a', roleId: 'climber' }] }),
    shift({ id: '2', date: '2026-10-31', urgent: true, crew: [{ workerId: 'a', roleId: 'climber' }] }), // Saturday, urgent
    shift({ id: '3', date: '2026-11-01', crew: [{ workerId: 'a', roleId: 'climber' }] }), // next week
  ]
  it('counts every shift of the worker from Sunday to Saturday, urgent ones included', () => {
    expect(weekShiftCount('a', '2026-10-28', records)).toBe(2)
    expect(weekShiftCount('b', '2026-10-28', records)).toBe(0)
  })
  it('leaves out the shift being edited', () => {
    expect(weekShiftCount('a', '2026-10-28', records, '1')).toBe(1)
  })
})

describe('sortShifts', () => {
  it('orders by date, planned before urgent, urgent by start time', () => {
    const r = sortShifts([
      shift({ id: 'u2', urgent: true, startTime: '23:00' }),
      shift({ id: 'u1', urgent: true, startTime: '08:00' }),
      shift({ id: 'p' }),
      shift({ id: 'old', date: '2026-10-27' }),
    ])
    expect(r.map((x) => x.id)).toEqual(['old', 'p', 'u1', 'u2'])
  })
})

describe('closing a night job', () => {
  const close = (outcome: ShiftClosure['outcome'], extra: Partial<ShiftClosure> = {}): ShiftClosure => ({ outcome, reasonIds: [], closedAt: '2026-10-29T16:00:00Z', ...extra })

  it('partial needs a note; postponed needs a reason or a note; done needs nothing', () => {
    expect(closureError(close('partial'))).toBe('צריך לכתוב מה נשאר לעשות')
    expect(closureError(close('partial', { note: 'נשאר חיווט' }))).toBeNull()
    expect(closureError(close('postponed'))).toBe('צריך לבחור סיבה או לכתוב אותה')
    expect(closureError(close('postponed', { reasonIds: ['rain'] }))).toBeNull()
    expect(closureError(close('done'))).toBeNull()
  })

  it('partial or postponed leaves one waiting job with the same place and work', () => {
    const { records, pending } = applyClosure([shift()], [], 's1', close('postponed', { reasonIds: ['rain'] }))
    expect(records[0].closure?.outcome).toBe('postponed')
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ location: 'חיפה', jobDescription: 'התקנת אנטנה', fromShiftId: 's1', reasonIds: ['rain'] })

    const again = applyClosure(records, pending, 's1', close('partial', { note: 'נשאר חיווט' }))
    expect(again.pending).toHaveLength(1)
    expect(again.pending[0]).toMatchObject({ id: pending[0].id, outcome: 'partial', note: 'נשאר חיווט' })
  })

  it('changing to done, or reopening, removes the waiting job', () => {
    const first = applyClosure([shift()], [], 's1', close('partial', { note: 'x' }))
    expect(applyClosure(first.records, first.pending, 's1', close('done')).pending).toHaveLength(0)
    const reopened = applyClosure(first.records, first.pending, 's1', undefined)
    expect(reopened.pending).toHaveLength(0)
    expect(reopened.records[0].closure).toBeUndefined()
  })
})

describe('waiting jobs across both files', () => {
  const closeAt = (outcome: ShiftClosure['outcome'], note = 'x'): ShiftClosure => ({ outcome, note, reasonIds: [], closedAt: '2026-10-29T16:00:00Z' })

  it('scheduling marks the job, idempotently, so a retried save never leaves it waiting', () => {
    const { records, pending } = applyClosure([shift()], [], 's1', closeAt('partial'))
    const s2 = shift({ id: 's2', fromJobId: pending[0].id })
    const once = pendingAfterShiftSave(pending, s2)
    expect(once[0].scheduledShiftId).toBe('s2')
    expect(pendingAfterShiftSave(once, s2)).toBe(once) // retry: nothing to write
    expect(isWaiting(once[0], [...records, s2])).toBe(false)
  })

  it('cancelling the shift it was scheduled into brings the job back', () => {
    const job = { id: 'j', location: 'חיפה', jobDescription: 'x', reasonIds: [], createdAt: '', scheduledShiftId: 's2' }
    expect(isWaiting(job, [shift()])).toBe(true)
  })

  it('re-closing the original night job keeps an already scheduled job scheduled', () => {
    const first = applyClosure([shift()], [], 's1', closeAt('partial'))
    const scheduled = pendingAfterShiftSave(first.pending, shift({ id: 's2', fromJobId: first.pending[0].id }))
    const again = applyClosure(first.records, scheduled, 's1', closeAt('partial', 'עוד הערה'))
    expect(again.pending[0]).toMatchObject({ scheduledShiftId: 's2', note: 'עוד הערה' })
  })

  it('editing a closed shift updates the place and work of the job it left behind', () => {
    const first = applyClosure([shift()], [], 's1', closeAt('postponed'))
    const next = pendingAfterShiftSave(first.pending, shift({ location: 'עכו' }))
    expect(next[0].location).toBe('עכו')
  })

  it('closing as done with nothing waiting changes nothing in the waiting file', () => {
    const pending: never[] = []
    expect(applyClosure([shift()], pending, 's1', closeAt('done')).pending).toBe(pending)
  })

  it('names the worker whose role is missing, and ignores deleted roles', () => {
    const w = worker('דני', ['gone'])
    expect(shiftRecordError(shift({ crew: [{ workerId: 'דני', roleId: '' }] }), [w], ['climber'])).toBeNull()
    expect(shiftRecordError(shift({ crew: [{ workerId: 'דני', roleId: 'x' }] }), [worker('דני')], ['climber'])).toBe('צריך לבחור תפקיד לדני')
  })
})
