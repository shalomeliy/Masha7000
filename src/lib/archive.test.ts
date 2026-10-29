import { describe, expect, it } from 'vitest'
import { archivePlaces, archiveShifts, archiveSummary, crewSwaps, rangeDates, taskLinks } from './archive'
import type { PendingJob, ShiftRecord, Worker } from '../types/models'

const worker = (id: string, firstName: string): Worker => ({ id, firstName, lastName: 'כהן', roleIds: [], certificationIds: [], constraints: [] })
const workers = [worker('a', 'דני'), worker('b', 'יוסי'), worker('c', 'רונית')]

const shift = (id: string, date: string, extra: Partial<ShiftRecord> = {}): ShiftRecord => ({
  id,
  date,
  location: 'חיפה',
  jobDescription: 'התקנת אנטנה',
  crew: [{ workerId: 'a', roleId: 'general' }],
  staffing: [],
  ...extra,
})

const records = [
  shift('1', '2026-05-01'),
  shift('2', '2026-09-10', { location: 'תל אביב', crew: [{ workerId: 'b', roleId: 'general' }], swaps: [{ at: '2026-09-09T10:00:00Z', outId: 'a', inId: 'b', roleId: 'general' }] }),
  shift('3', '2026-10-20', { location: ' חיפה ', jobDescription: 'תיקון מצלמה', closure: { outcome: 'postponed', note: 'גשם חזק', reasonIds: [], closedAt: '' } }),
  shift('4', '2026-10-20', { urgent: true, startTime: '09:00', crew: [{ workerId: 'c', roleId: 'general' }] }),
]

describe('archiveShifts', () => {
  it('lists newest first, within the dates', () => {
    expect(archiveShifts(records, { from: '2026-09-01', to: '2026-10-31' }, workers).map((r) => r.id)).toEqual(['4', '3', '2'])
    expect(archiveShifts(records, { from: '', to: '' }, workers)).toHaveLength(4)
  })

  it('finds a worker who worked, or was swapped out', () => {
    expect(archiveShifts(records, { from: '', to: '', workerId: 'a' }, workers).map((r) => r.id)).toEqual(['3', '2', '1'])
    expect(archiveShifts(records, { from: '', to: '', workerId: 'c' }, workers).map((r) => r.id)).toEqual(['4'])
  })

  it('matches the place without spaces or case', () => {
    expect(archiveShifts(records, { from: '', to: '', location: 'חיפה' }, workers).map((r) => r.id)).toEqual(['4', '3', '1'])
  })

  it('searches work, closing notes and worker names, every word', () => {
    const ids = (text: string) => archiveShifts(records, { from: '', to: '', text }, workers).map((r) => r.id)
    expect(ids('גשם')).toEqual(['3'])
    expect(ids('מצלמה דני')).toEqual(['3'])
    expect(ids('רונית')).toEqual(['4'])
    expect(ids('אין כזה')).toEqual([])
  })
})

describe('archive helpers', () => {
  it('quick ranges end today; "all" is open', () => {
    expect(rangeDates(30, '2026-10-29')).toEqual({ from: '2026-09-29', to: '2026-10-29' })
    expect(rangeDates(0, '2026-10-29')).toEqual({ from: '', to: '' })
  })

  it('lists each place once', () => {
    expect(archivePlaces(records)).toEqual(['חיפה', 'תל אביב'])
  })

  it('counts outcomes, urgent shifts and swaps', () => {
    expect(archiveSummary(records)).toEqual({ shifts: 4, urgent: 1, done: 0, partial: 0, postponed: 1, swaps: 1 })
  })

  it('links a postponed shift to where its job went, and back', () => {
    const later = shift('5', '2026-10-25', { fromJobId: 'j' })
    const jobs: PendingJob[] = [{ id: 'j', location: '', jobDescription: '', staffing: [], reasonIds: [], createdAt: '', fromShiftId: '3', scheduledShiftId: '5' }]
    expect(taskLinks(records[2], [...records, later], jobs).next?.id).toBe('5')
    expect(taskLinks(later, [...records, later], jobs).prev?.id).toBe('3')
    expect(taskLinks(records[0], records, jobs)).toEqual({ left: undefined, next: undefined, prev: undefined })
  })
})

describe('crewSwaps', () => {
  const crew = (...ids: string[]) => ids.map((workerId) => ({ workerId, roleId: 'r' }))
  it('a place whose worker changed is a swap', () => {
    expect(crewSwaps(crew('a', 'b'), crew('a', 'c'), 'T')).toEqual([{ at: 'T', outId: 'b', inId: 'c', roleId: 'r' }])
  })
  it('adding, removing or reordering is not a swap', () => {
    expect(crewSwaps(crew('a', 'b'), crew('b'), 'T')).toEqual([])
    expect(crewSwaps(crew('a'), crew('a', 'c'), 'T')).toEqual([])
    expect(crewSwaps(crew('a', 'b'), crew('b', 'a'), 'T')).toEqual([])
    expect(crewSwaps([], crew('a'), 'T')).toEqual([])
  })
})
