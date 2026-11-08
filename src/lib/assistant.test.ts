import { describe, expect, it } from 'vitest'
import { applyProposal, isYes, relevantExamples, jobStaffing, proposalErrors, snapshot, type AppData, type Proposal, type ProposedJob } from './assistant'
import { NO_EDITS } from './assistantEdits'
import type { Worker } from '../types/models'

const worker = (id: string, firstName: string, roleIds: string[]): Worker => ({ id, firstName, lastName: 'כהן', certificationIds: roleIds, constraints: [] })

const data = (): AppData => ({
  certifications: [{ id: 'climb', name: 'טפסן' }, { id: 'cam', name: 'טכנאי מצלמות' }, { id: 'h40', name: 'אנטנה בגובה 40 מטר' }],
  workers: [worker('w1', 'דני', ['climb']), worker('w2', 'יוסי', ['climb']), worker('w3', 'רון', ['cam'])],
  shiftDefinitions: [
    { id: 'day', name: 'יום', requiredCertificationIds: [], startTime: '07:00', endTime: '16:00' },
    { id: 'night', name: 'לילה', requiredCertificationIds: [], startTime: '07:00', endTime: '16:00', endsNextDay: true },
  ],
  shifts: [{ id: 's1', date: '2026-11-09', shiftDefinitionId: 'day', location: 'באר שבע', jobDescription: 'תחזוקה', crew: [], staffing: [{ certificationIds: ['cam'] }] }],
  pendingJobs: [],
  places: [{ id: 'p1', name: 'אילת אתר 123' }],
  jobTypes: [],
  workKinds: [{ id: 'k1', name: 'טיפוס', staffing: [{ certificationIds: ['climb'] }, { certificationIds: ['climb'] }] }],
  postponeReasons: [],
  assistantNotes: [{ id: 'n1', text: 'מטפס זה טפסן', createdAt: '2026-11-01T10:00:00Z' }],
  departments: [],
  assistantExamples: [],
})

const job = (over: Partial<ProposedJob> = {}): ProposedJob => ({
  date: '2026-11-08',
  shiftKindId: 'night',
  location: 'אילת אתר 123',
  jobDescription: 'החלפת מצלמה',
  staffing: [
    { count: 2, certificationIds: ['climb'] },
    { count: 1, certificationIds: ['cam'] },
  ],
  workKindIds: [],
  note: '',
  autoAssign: false,
  nextJob: { location: '', jobDescription: '' },
  crew: [],
  ...over,
})

const proposal = (over: Partial<Proposal> = {}): Proposal => ({ summary: '', jobs: [], assignShiftIds: [], workers: [], listItems: [], rememberNotes: [], lessons: [], forgetNoteIds: [], ...NO_EDITS, ...over })
const NOW = new Date('2026-11-06T20:00:00')

describe('snapshot', () => {
  it('gives names, active workers and near shifts with crew names', () => {
    const d = data()
    d.shifts[0].crew = [{ workerId: 'w3' }]
    d.workers.push({ ...worker('w4', 'עזב', []), status: 'inactive' })
    const s = snapshot(d, NOW)
    expect(s.today).toBe('2026-11-06 (יום שישי)')
    expect(s.workers.map((w) => w.name)).toEqual(['דני כהן', 'יוסי כהן', 'רון כהן'])
    expect(s.shifts[0]).toMatchObject({ id: 's1', kind: 'יום', crew: ['רון כהן'], needs: ['טכנאי מצלמות'] })
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
      proposal({ jobs: [job({ date: '8.11', shiftKindId: 'x', staffing: [{ count: 1, certificationIds: ['nope'] }] })], assignShiftIds: ['gone'] }),
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
  it('one place per person', () => expect(jobStaffing(job(), data()).staffing).toEqual([{ certificationIds: ['climb'] }, { certificationIds: ['climb'] }, { certificationIds: ['cam'] }]))

  it('work kinds add their own places, marked with the kind', () => {
    const r = jobStaffing(job({ staffing: [], workKindIds: ['k1'] }), data())
    expect(r.workKindIds).toEqual(['k1'])
    expect(r.staffing).toEqual([
      { certificationIds: ['climb'], kindId: 'k1' },
      { certificationIds: ['climb'], kindId: 'k1' },
    ])
  })

  it('nobody named: one general place', () => expect(jobStaffing(job({ staffing: [] }), data()).staffing).toEqual([{}]))
})

describe('applyProposal', () => {
  it('a description of several tasks is saved as a numbered list, in the calendar and the waiting list', () => {
    const said = 'החלפת נורה וניקוי עדשה'
    const r = applyProposal(proposal({ jobs: [job({ jobDescription: said }), job({ date: '', jobDescription: said })] }), data(), NOW)
    expect(r.data.shifts[1].jobDescription).toBe('1. החלפת נורה\n2. ניקוי עדשה')
    expect(r.data.pendingJobs[0].jobDescription).toBe('1. החלפת נורה\n2. ניקוי עדשה')
  })
  it('a job with a date goes to the calendar, without one to the waiting list', () => {
    const r = applyProposal(proposal({ jobs: [job(), job({ date: '', location: 'דימונה אתר 556' })] }), data(), NOW)
    expect([...r.changed].sort()).toEqual(['pendingJobs', 'shifts'])
    expect(r.data.shifts).toHaveLength(2)
    expect(r.data.shifts[1]).toMatchObject({ date: '2026-11-08', shiftDefinitionId: 'night', location: 'אילת אתר 123', crew: [] })
    expect(r.data.pendingJobs[0]).toMatchObject({ location: 'דימונה אתר 556', reasonIds: [], createdAt: NOW.toISOString() })
    expect(r.report).toEqual(['הוספתי עבודה ליומן', 'הוספתי עבודה לרשימת הממתינות'])
  })

  it('a job with no date may have no kind ("לא יודע אם יום או לילה", the owner, 2026-11-08)', () => {
    const open = job({ date: '', shiftKindId: '' })
    expect(proposalErrors(proposal({ jobs: [open] }), data())).toEqual([])
    const r = applyProposal(proposal({ jobs: [open] }), data(), NOW)
    expect(r.report).toEqual(['הוספתי עבודה לרשימת הממתינות'])
    expect(r.data.pendingJobs[0]).toMatchObject({ location: 'אילת אתר 123' })
    expect(r.data.pendingJobs[0].shiftDefinitionId).toBeUndefined()
    // On the calendar a job needs its kind.
    expect(proposalErrors(proposal({ jobs: [job({ shiftKindId: '' })] }), data())).toHaveLength(1)
  })

  it('auto-assigns a new job and an existing one', () => {
    const r = applyProposal(proposal({ jobs: [job({ autoAssign: true })], assignShiftIds: ['s1'] }), data(), NOW)
    const fresh = r.data.shifts.find((s) => s.date === '2026-11-08')!
    // רון went to באר שבע first; the night job runs into that day, so his place stays empty.
    expect(fresh.crew.map((c) => c.workerId).sort()).toEqual(['w1', 'w2'])
    expect(r.report).toContain('באילת אתר 123 נשארו מקום אחד פנוי')
    expect(r.data.shifts.find((s) => s.id === 's1')!.crew).toEqual([{ workerId: 'w3' }])
    expect(r.report).toContain('בבאר שבע שיבצתי את רון')
  })

  it('adds workers and list items', () => {
    const r = applyProposal(
      proposal({
        workers: [{ firstName: 'משה', lastName: 'לוי', mobilePhone: '050-123 4567', certificationIds: ['cam'] }],
        listItems: [{ list: 'places', name: ' דימונה אתר 556 ' }],
      }),
      data(),
      NOW,
    )
    expect(r.data.workers.at(-1)).toMatchObject({ firstName: 'משה', mobilePhone: '0501234567', certificationIds: ['cam'], constraints: [] })
    expect(r.data.places.map((p) => p.name)).toEqual(['אילת אתר 123', 'דימונה אתר 556'])
    expect([...r.changed].sort()).toEqual(['places', 'workers'])
  })

  it('does not touch the data it was given', () => {
    const d = data()
    applyProposal(proposal({ jobs: [job()] }), d, NOW)
    expect(d.shifts).toHaveLength(1)
  })
})

describe('version 2 context', () => {
  const lina = { id: 'night-plus', name: 'לינה', requiredCertificationIds: [], startTime: '07:00', endTime: '16:00', endsNextDay: true, thenJob: true }

  it('lists the coming days by name, so "ראשון הקרוב" is looked up', () => {
    const s = snapshot(data(), NOW)
    expect(s.days[0]).toBe('2026-11-06 = היום, יום שישי 6.11')
    expect(s.days[2]).toBe('2026-11-08 = יום ראשון 8.11')
    expect(s.days).toHaveLength(21)
  })

  it('explains each job kind, and marks the one with a job after the night', () => {
    const d = data()
    d.shiftDefinitions.push(lina)
    const kinds = snapshot(d, NOW).shiftKinds
    expect(kinds.find((k) => k.id === 'night-plus')).toMatchObject({ night: true, hasNextJob: true })
    expect(kinds.find((k) => k.id === 'night-plus')?.meaning).toContain('כולל לינה')
    expect(kinds.find((k) => k.id === 'day')).toMatchObject({ night: false })
  })

  it('counts the last weeks: jobs, nights, places and partners; and what to remember', () => {
    const d = data()
    d.shifts = [
      { id: 'a', date: '2026-11-01', shiftDefinitionId: 'night', location: 'אילת', jobDescription: 'החלפה', crew: [{ workerId: 'w1' }, { workerId: 'w2' }], staffing: [] },
      { id: 'b', date: '2026-11-03', shiftDefinitionId: 'day', location: 'אילת', jobDescription: 'תחזוקה', crew: [{ workerId: 'w1' }], staffing: [] },
      { id: 'c', date: '2026-08-01', shiftDefinitionId: 'day', location: 'רחוק', jobDescription: '', crew: [{ workerId: 'w1' }], staffing: [] },
    ]
    const s = snapshot(d, NOW)
    expect(s.history.workers.find((w) => w.name === 'דני כהן')).toEqual({ name: 'דני כהן', jobs: 2, nights: 1, last: '2026-11-03', places: ['אילת (2)'], with: ['יוסי כהן'] })
    expect(s.history.places).toEqual([{ place: 'אילת', jobs: 2, last: '2026-11-03', work: ['החלפה', 'תחזוקה'], crew: ['דני כהן (2)', 'יוסי כהן'] }])
    expect(s.remembered).toEqual([{ id: 'n1', text: 'מטפס זה טפסן' }])
  })

  it('tells what a worker cannot do, leaving out what is over', () => {
    const d = data()
    d.workers[0].constraints = [
      { id: 'x', when: 'dates', from: '2026-11-10', to: '2026-11-10' },
      { id: 'y', when: 'dates', from: '2026-10-01', to: '2026-10-02' },
    ]
    expect(snapshot(d, NOW).workers[0].cannot).toEqual(['לא זמין ב-10.11'])
  })

  it('a לינה job keeps its next job; a day job drops it; waiting jobs get it in the note', () => {
    const d = data()
    d.shiftDefinitions.push(lina)
    const next = { location: 'דימונה', jobDescription: 'בדיקה' }
    const out = applyProposal(
      proposal({ jobs: [job({ shiftKindId: 'night-plus', nextJob: next }), job({ shiftKindId: 'day', nextJob: next }), job({ date: '', shiftKindId: 'night-plus', nextJob: next })] }),
      d,
      NOW,
    ).data
    expect(out.shifts.at(-2)?.nextJob).toEqual(next)
    expect(out.shifts.at(-1)?.nextJob).toBeUndefined()
    expect(out.pendingJobs[0].note).toBe('אחרי הלינה: דימונה - בדיקה')
  })

  it('remembers and forgets notes', () => {
    const r = applyProposal(proposal({ rememberNotes: ['דני לא נוסע לאילת'], forgetNoteIds: ['n1'] }), data(), NOW)
    expect(r.data.assistantNotes.map((n) => n.text)).toEqual(['דני לא נוסע לאילת'])
    expect(r.changed.has('assistantNotes')).toBe(true)
    expect(proposalErrors(proposal({ forgetNoteIds: ['nope'] }), data())).toEqual(['אין הערה שמורה עם id "nope"'])
  })
})

describe('isYes', () => {
  it.each(['כן', 'מאשר', 'כן, לאשר.', 'סגור', 'יאללה'])('%s', (s) => expect(isYes(s)).toBe(true))
  it.each(['לא', 'כן אבל תוסיף חשמלאי', 'תוסיף עוד אחד'])('%s', (s) => expect(isYes(s)).toBe(false))
})

describe('learning from the manager', () => {
  it('saves new lessons as learned notes, once, with the yes', () => {
    const r = applyProposal(proposal({ jobs: [job()], lessons: ['מטפס זה טפסן', 'המנהל מעדיף לדחות עבודות גובה כשחסר מוסמך', ''] }), data(), NOW)
    expect(r.data.assistantNotes.map((n) => [n.text, n.learned ?? false])).toEqual([
      ['מטפס זה טפסן', false],
      ['המנהל מעדיף לדחות עבודות גובה כשחסר מוסמך', true],
    ])
  })

  it('a lesson alone is not a change to confirm', () => expect(proposalErrors(proposal({ lessons: ['x'] }), data())).toEqual(['אין בהצעה שום שינוי']))

  it('sends the examples closest to what was said, newest on a tie', () => {
    const ex = (id: string, said: string) => ({ id, said, did: '', createdAt: '' })
    const all = [ex('1', 'לינה באילת שני טפסנים'), ex('2', 'עובד חדש'), ex('3', 'יום בדימונה טפסן'), ex('4', 'לינה בערד')]
    expect(relevantExamples(all, 'תפתח לינה באילת', 2).map((e) => e.id)).toEqual(['1', '4'])
    expect(relevantExamples(all, 'משהו אחר', 2).map((e) => e.id)).toEqual(['4', '3'])
  })
})

describe('a new job with named workers', () => {
  it('puts them in; a worker who does not exist is refused', () => {
    const d = data()
    const named = job({ crew: [{ workerId: 'w1' }] })
    expect(applyProposal(proposal({ jobs: [named] }), d, NOW).data.shifts.at(-1)?.crew).toEqual([{ workerId: 'w1' }])
    expect(proposalErrors(proposal({ jobs: [job({ crew: [{ workerId: 'nobody' }] })] }), d)).toHaveLength(1)
  })
})
