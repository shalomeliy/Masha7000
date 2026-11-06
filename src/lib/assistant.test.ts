import { describe, expect, it } from 'vitest'
import { applyProposal, isYes, jobStaffing, proposalErrors, snapshot, type AppData, type Proposal, type ProposedJob } from './assistant'
import type { Worker } from '../types/models'

const G = 'general'
const worker = (id: string, firstName: string, roleIds: string[]): Worker => ({ id, firstName, lastName: 'כהן', roleIds, certificationIds: [], constraints: [] })

const data = (): AppData => ({
  roles: [
    { id: G, name: 'כללי' },
    { id: 'climb', name: 'טפסן' },
    { id: 'cam', name: 'טכנאי מצלמות' },
  ],
  certifications: [{ id: 'h40', name: 'אנטנה בגובה 40 מטר' }],
  workers: [worker('w1', 'דני', ['climb']), worker('w2', 'יוסי', ['climb']), worker('w3', 'רון', ['cam'])],
  shiftDefinitions: [
    { id: 'day', name: 'יום', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00' },
    { id: 'night', name: 'לילה', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00', endsNextDay: true },
  ],
  shifts: [{ id: 's1', date: '2026-11-09', shiftDefinitionId: 'day', location: 'באר שבע', jobDescription: 'תחזוקה', crew: [], staffing: [{ roleId: 'cam' }] }],
  pendingJobs: [],
  places: [{ id: 'p1', name: 'אילת אתר 123' }],
  jobTypes: [],
  workKinds: [{ id: 'k1', name: 'טיפוס', staffing: [{ roleId: 'climb' }, { roleId: 'climb' }] }],
  postponeReasons: [],
})

const job = (over: Partial<ProposedJob> = {}): ProposedJob => ({
  date: '2026-11-08',
  shiftKindId: 'night',
  location: 'אילת אתר 123',
  jobDescription: 'החלפת מצלמה',
  staffing: [
    { roleId: 'climb', count: 2, certificationIds: [] },
    { roleId: 'cam', count: 1, certificationIds: [] },
  ],
  workKindIds: [],
  note: '',
  autoAssign: false,
  ...over,
})

const proposal = (over: Partial<Proposal> = {}): Proposal => ({ summary: '', jobs: [], assignShiftIds: [], workers: [], listItems: [], ...over })
const NOW = new Date('2026-11-06T20:00:00')

describe('snapshot', () => {
  it('gives names, active workers and near shifts with crew names', () => {
    const d = data()
    d.shifts[0].crew = [{ workerId: 'w3', roleId: 'cam' }]
    d.workers.push({ ...worker('w4', 'עזב', []), status: 'inactive' })
    const s = snapshot(d, NOW)
    expect(s.today).toBe('2026-11-06 (יום שישי)')
    expect(s.workers.map((w) => w.name)).toEqual(['דני כהן', 'יוסי כהן', 'רון כהן'])
    expect(s.shifts[0]).toMatchObject({ id: 's1', kind: 'יום', crew: ['רון כהן (טכנאי מצלמות)'], needs: ['טכנאי מצלמות'] })
  })

  it('leaves out shifts far in the past', () => {
    const d = data()
    d.shifts[0].date = '2026-09-01'
    expect(snapshot(d, NOW).shifts).toEqual([])
  })
})

describe('proposalErrors', () => {
  it('accepts a good proposal', () => expect(proposalErrors(proposal({ jobs: [job()] }), data())).toEqual([]))

  it('finds invented ids, bad dates and empty proposals', () => {
    const errors = proposalErrors(
      proposal({ jobs: [job({ date: '8.11', shiftKindId: 'x', staffing: [{ roleId: 'nope', count: 1, certificationIds: [] }] })], assignShiftIds: ['gone'] }),
      data(),
    )
    expect(errors).toHaveLength(4)
    expect(proposalErrors(proposal(), data())).toEqual(['אין בהצעה שום שינוי'])
  })

  it('refuses a list item that already exists', () =>
    expect(proposalErrors(proposal({ listItems: [{ list: 'places', name: 'אילת אתר 123' }] }), data())).toHaveLength(1))

  it('auto-assign needs a date', () => expect(proposalErrors(proposal({ jobs: [job({ date: '', autoAssign: true })] }), data())).toHaveLength(1))
})

describe('jobStaffing', () => {
  it('one place per person', () => expect(jobStaffing(job(), data()).staffing).toEqual([{ roleId: 'climb' }, { roleId: 'climb' }, { roleId: 'cam' }]))

  it('work kinds add their own places, marked with the kind', () => {
    const r = jobStaffing(job({ staffing: [], workKindIds: ['k1'] }), data())
    expect(r.workKindIds).toEqual(['k1'])
    expect(r.staffing).toEqual([
      { roleId: 'climb', kindId: 'k1' },
      { roleId: 'climb', kindId: 'k1' },
    ])
  })

  it('nobody named: one general place', () => expect(jobStaffing(job({ staffing: [] }), data()).staffing).toEqual([{ roleId: G }]))
})

describe('applyProposal', () => {
  it('a job with a date goes to the calendar, without one to the waiting list', () => {
    const r = applyProposal(proposal({ jobs: [job(), job({ date: '', location: 'דימונה אתר 556' })] }), data(), NOW)
    expect([...r.changed].sort()).toEqual(['pendingJobs', 'shifts'])
    expect(r.data.shifts).toHaveLength(2)
    expect(r.data.shifts[1]).toMatchObject({ date: '2026-11-08', shiftDefinitionId: 'night', location: 'אילת אתר 123', crew: [] })
    expect(r.data.pendingJobs[0]).toMatchObject({ location: 'דימונה אתר 556', reasonIds: [], createdAt: NOW.toISOString() })
    expect(r.report).toEqual(['הוספתי עבודה ליומן', 'הוספתי עבודה לרשימת הממתינות'])
  })

  it('auto-assigns a new job and an existing one', () => {
    const r = applyProposal(proposal({ jobs: [job({ autoAssign: true })], assignShiftIds: ['s1'] }), data(), NOW)
    const fresh = r.data.shifts.find((s) => s.date === '2026-11-08')!
    // רון went to באר שבע first; the night job runs into that day, so his place stays empty.
    expect(fresh.crew.map((c) => c.workerId).sort()).toEqual(['w1', 'w2'])
    expect(r.report).toContain('באילת אתר 123 נשארו מקום אחד פנוי')
    expect(r.data.shifts.find((s) => s.id === 's1')!.crew).toEqual([{ workerId: 'w3', roleId: 'cam' }])
    expect(r.report).toContain('בבאר שבע שיבצתי את רון')
  })

  it('adds workers and list items', () => {
    const r = applyProposal(
      proposal({
        workers: [{ firstName: 'משה', lastName: 'לוי', mobilePhone: '050-123 4567', roleIds: [G, 'cam'], certificationIds: [] }],
        listItems: [{ list: 'places', name: ' דימונה אתר 556 ' }],
      }),
      data(),
      NOW,
    )
    expect(r.data.workers.at(-1)).toMatchObject({ firstName: 'משה', mobilePhone: '0501234567', roleIds: ['cam'], constraints: [] })
    expect(r.data.places.map((p) => p.name)).toEqual(['אילת אתר 123', 'דימונה אתר 556'])
    expect([...r.changed].sort()).toEqual(['places', 'workers'])
  })

  it('does not touch the data it was given', () => {
    const d = data()
    applyProposal(proposal({ jobs: [job()] }), d, NOW)
    expect(d.shifts).toHaveLength(1)
  })
})

describe('isYes', () => {
  it.each(['כן', 'מאשר', 'כן, לאשר.', 'סגור', 'יאללה'])('%s', (s) => expect(isYes(s)).toBe(true))
  it.each(['לא', 'כן אבל תוסיף חשמלאי', 'תוסיף עוד אחד'])('%s', (s) => expect(isYes(s)).toBe(false))
})
