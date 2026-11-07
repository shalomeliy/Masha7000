import { describe, expect, it } from 'vitest'
import { applyProposal, normalizeProposal, proposalConflicts, proposalErrors, summaryWithConflicts, type AppData, type Proposal } from './assistant'
import { NO_EDITS, type EditJob, type Edits } from './assistantEdits'
import type { Worker } from '../types/models'

const G = 'general'
const worker = (id: string, firstName: string, roleIds: string[], extra: Partial<Worker> = {}): Worker => ({ id, firstName, lastName: 'כהן', roleIds, certificationIds: [], constraints: [], ...extra })

const data = (): AppData => ({
  roles: [{ id: G, name: 'כללי' }, { id: 'climb', name: 'טפסן' }, { id: 'el', name: 'חשמלאי' }],
  certifications: [{ id: 'h40', name: 'גובה 40' }],
  workers: [worker('w1', 'דני', ['climb']), worker('w2', 'יוסי', ['climb']), worker('w3', 'אבי', ['el']), worker('w4', 'עזב', ['climb'], { status: 'inactive' })],
  shiftDefinitions: [
    { id: 'day', name: 'יום', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00' },
    { id: 'night', name: 'לילה', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00', endsNextDay: true },
  ],
  shifts: [
    { id: 's1', date: '2026-11-09', shiftDefinitionId: 'day', location: 'דימונה', jobDescription: 'חשמל', crew: [{ workerId: 'w1', roleId: 'climb' }], staffing: [{ roleId: 'climb' }] },
    { id: 's2', date: '2026-11-10', shiftDefinitionId: 'night', location: 'ערד', jobDescription: 'אנטנה', crew: [{ workerId: 'w2', roleId: 'climb' }], staffing: [{ roleId: 'climb' }] },
  ],
  pendingJobs: [{ id: 'p1', location: 'אילת', jobDescription: 'מצלמה', staffing: [{ roleId: 'climb' }], reasonIds: [], createdAt: '2026-11-01T00:00:00Z' }],
  places: [],
  jobTypes: [],
  workKinds: [],
  postponeReasons: [],
  assistantNotes: [],
  departments: [],
  assistantExamples: [],
})

const NOW = new Date('2026-11-06T20:00:00')
const p = (e: Partial<Edits>): Proposal => ({ summary: '', jobs: [], assignShiftIds: [], workers: [], listItems: [], rememberNotes: [], lessons: [], forgetNoteIds: [], ...NO_EDITS, ...e })
const edit = (over: Partial<EditJob>): EditJob => ({ id: 's1', date: '', shiftKindId: '', location: '', jobDescription: '', staffing: [], autoAssign: false, ...over })

describe('editing jobs', () => {
  it('moves a job and changes only what was said', () => {
    const out = applyProposal(p({ editJobs: [edit({ date: '2026-11-11', jobDescription: 'חיבור חשמל' })] }), data(), NOW).data
    expect(out.shifts.find((s) => s.id === 's1')).toMatchObject({ date: '2026-11-11', location: 'דימונה', jobDescription: 'חיבור חשמל', crew: [{ workerId: 'w1' }] })
  })

  it('a waiting job with a date goes into the calendar and is marked scheduled', () => {
    const r = applyProposal(p({ editJobs: [edit({ id: 'p1', date: '2026-11-12', autoAssign: true })] }), data(), NOW)
    const created = r.data.shifts.find((s) => s.location === 'אילת')!
    expect(created).toMatchObject({ date: '2026-11-12', fromJobId: 'p1' })
    expect(r.data.pendingJobs[0].scheduledShiftId).toBe(created.id)
    expect(created.crew).toHaveLength(1) // auto-assigned
  })

  it('moving a job onto a day its worker already works: the manager hears it, and the yes moves him', () => {
    const d = data()
    d.shifts[1].crew = [{ workerId: 'w1', roleId: 'climb' }]
    const proposal = p({ editJobs: [edit({ date: '2026-11-10' })] })
    expect(proposalErrors(proposal, d)).toEqual([])
    expect(proposalConflicts(proposal, d)).toEqual(['דני כבר משובץ באותו זמן בערד (יום שלישי 10.11). אם תאשר, אעביר אותו לדימונה, ושם יישאר מקום ריק'])
    const out = applyProposal(proposal, d, NOW).data
    expect(out.shifts.find((s) => s.id === 's2')?.crew).toEqual([])
    expect(out.shifts.find((s) => s.id === 's1')?.crew.map((c) => c.workerId)).toEqual(['w1'])
  })

  it('the same worker in two jobs of one proposal at the same time is refused', () => {
    const d = data()
    d.shifts[1].date = '2026-11-09'
    const both = p({ setCrews: [{ shiftId: 's1', crew: [{ workerId: 'w2', roleId: 'climb' }] }, { shiftId: 's2', crew: [{ workerId: 'w2', roleId: 'climb' }] }] })
    expect(proposalErrors(both, d).join()).toContain('יוסי כהן כבר בעבודה')
  })

  it('a closed job is never emptied', () => {
    const d = data()
    d.shifts[1] = { ...d.shifts[1], date: '2026-11-09', crew: [{ workerId: 'w2', roleId: 'climb' }], closure: { outcome: 'done', reasonIds: [], closedAt: '' } }
    expect(proposalErrors(p({ setCrews: [{ shiftId: 's1', crew: [{ workerId: 'w2', roleId: 'climb' }] }] }), d).join()).toContain('יוסי כהן כבר בעבודה')
  })
})

describe('setting a crew', () => {
  it('puts the named workers in, and keeps the replaced one in the history', () => {
    const out = applyProposal(p({ setCrews: [{ shiftId: 's1', crew: [{ workerId: 'w3', roleId: 'el' }] }] }), data(), NOW).data
    const s1 = out.shifts.find((s) => s.id === 's1')!
    expect(s1.crew).toEqual([{ workerId: 'w3', roleId: 'el' }])
    expect(s1.swaps).toEqual([{ at: NOW.toISOString(), outId: 'w1', inId: 'w3', roleId: 'el' }])
  })

  it('refuses a role the worker lacks and an inactive worker; a busy one is a move to confirm', () => {
    const errs = proposalErrors(p({ setCrews: [{ shiftId: 's1', crew: [{ workerId: 'w3', roleId: 'climb' }, { workerId: 'w4', roleId: 'climb' }] }] }), data())
    expect(errs).toEqual(['לאבי כהן אין את התפקיד טפסן', 'עזב כהן לא פעיל'])
    // Yossi is on the Arad night of 10.11; the 9.11 day job is free, but a night on 9.11 would not be.
    const d = data()
    d.shifts[1].date = '2026-11-08'
    expect(proposalConflicts(p({ setCrews: [{ shiftId: 's1', crew: [{ workerId: 'w2', roleId: 'climb' }] }] }), d)).toHaveLength(1)
  })
})

describe('closing and deleting', () => {
  it('closes a night job as postponed: it waits in "לשיבוץ"', () => {
    const out = applyProposal(p({ closeJobs: [{ shiftId: 's2', outcome: 'postponed', note: 'גשם' }] }), data(), NOW).data
    expect(out.shifts.find((s) => s.id === 's2')?.closure).toMatchObject({ outcome: 'postponed', note: 'גשם' })
    expect(out.pendingJobs.find((j) => j.fromShiftId === 's2')).toMatchObject({ location: 'ערד', outcome: 'postponed' })
  })

  it('refuses closing a day job', () =>
    expect(proposalErrors(p({ closeJobs: [{ shiftId: 's1', outcome: 'done', note: '' }] }), data())).toEqual(['סוגרים רק עבודות לילה, והעבודה בדימונה היא עבודת יום']))

  it('deletes from the calendar or the waiting list', () => {
    const out = applyProposal(p({ deleteJobIds: ['s1', 'p1'] }), data(), NOW).data
    expect(out.shifts.map((s) => s.id)).toEqual(['s2'])
    expect(out.pendingJobs).toEqual([])
  })
})

describe('workers', () => {
  const ew = { workerId: 'w1', mobilePhone: '', addRoleIds: [], removeRoleIds: [], addCertificationIds: [], removeCertificationIds: [], status: '' as const, sickUntil: '' }

  it('adds a role and a certification, sets sick', () => {
    const out = applyProposal(p({ editWorkers: [{ ...ew, addRoleIds: ['el'], addCertificationIds: ['h40'], status: 'sick', sickUntil: '2026-11-12' }] }), data(), NOW).data
    expect(out.workers[0]).toMatchObject({ roleIds: ['climb', 'el'], certificationIds: ['h40'], status: 'sick', sickUntil: '2026-11-12' })
  })

  it('sick needs a date; back to active clears it', () => {
    expect(proposalErrors(p({ editWorkers: [{ ...ew, status: 'sick' }] }), data())).toEqual(['דני: חולה עד איזה תאריך?'])
    const d = data()
    d.workers[0] = { ...d.workers[0], status: 'sick', sickUntil: '2026-11-12' }
    expect(applyProposal(p({ editWorkers: [{ ...ew, status: 'active' }] }), d, NOW).data.workers[0]).toMatchObject({ status: undefined, sickUntil: undefined })
  })

  it('adds a constraint', () => {
    const out = applyProposal(p({ addConstraints: [{ workerId: 'w2', from: '2026-11-15', to: '', nightsOnly: true, note: 'חתונה' }] }), data(), NOW).data
    expect(out.workers[1].constraints[0]).toMatchObject({ when: 'dates', from: '2026-11-15', to: '2026-11-15', nightsOnly: true, note: 'חתונה' })
  })
})

describe('normalizeProposal', () => {
  it('fills what a non-strict tool call left out, and drops wrong kinds', () => {
    const n = normalizeProposal({ summary: 'x', editJobs: [{ id: 's1', date: '2026-11-11' }], closeJobs: [{ shiftId: 's2', outcome: 'weird' }], listItems: [{ list: 'nope', name: 'a' }], jobs: 'bad' })
    expect(n.editJobs).toEqual([edit({ date: '2026-11-11' })])
    expect(n.closeJobs).toEqual([{ shiftId: 's2', outcome: 'done', note: '' }])
    expect(n.listItems).toEqual([])
    expect(n.jobs).toEqual([])
    expect(n.setCrews).toEqual([])
  })
})

describe('summaryWithConflicts', () => {
  it('says the move before the question', () =>
    expect(summaryWithConflicts('מזיז את דימונה לשלישי. לאשר, או שיש עוד תיקון?', ['דני כבר משובץ בערד'])).toBe('מזיז את דימונה לשלישי. שים לב: דני כבר משובץ בערד. לאשר, או שיש עוד תיקון?'))
  it('no conflicts: unchanged', () => expect(summaryWithConflicts('x', [])).toBe('x'))
})
