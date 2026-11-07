import { describe, expect, it } from 'vitest'
import { continueJob, exampleAction, handleFree, learn, type Local } from './freeCommands'
import { normalizeProposal, proposalErrors, type AppData } from './assistant'
import type { AssistantExample, ShiftRecord, Worker } from '../types/models'

const NOW = new Date('2026-11-07T10:00:00') // Saturday: ראשון = 11-08, שני = 11-09, שלישי = 11-10
const w = (id: string, firstName: string, lastName: string, roleIds: string[]): Worker => ({ id, firstName, lastName, roleIds, certificationIds: [], constraints: [] })
const shift = (id: string, date: string, location: string, crew: [string, string][], slots: string[]): ShiftRecord => ({
  id,
  date,
  shiftDefinitionId: 's1',
  location,
  jobDescription: 'תחזוקה',
  crew: crew.map(([workerId, roleId]) => ({ workerId, roleId })),
  staffing: slots.map((roleId) => ({ roleId })),
})

const base: AppData = {
  roles: [{ id: 'r1', name: 'טפסן' }, { id: 'r2', name: 'חשמלאי' }, { id: 'r4', name: 'טכנאי מצלמות' }],
  certifications: [],
  workers: [w('w1', 'דני', 'לוי', ['r1']), w('w2', 'יוסי', 'כהן', ['r1']), w('w3', 'אלי', 'פרץ', ['r1']), w('w4', 'רון', 'מזרחי', ['r1']), w('w5', 'משה', "תורג'מן", ['r1']), w('w6', 'אבי', 'אלפסי', ['r1'])],
  shiftDefinitions: [
    { id: 's1', name: 'יום', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00' },
    { id: 's2', name: 'לילה', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00', endsNextDay: true },
  ],
  shifts: [],
  pendingJobs: [],
  places: [{ id: 'p1', name: 'אילת אתר 123' }, { id: 'p2', name: 'דימונה 556' }, { id: 'p3', name: 'ערד 17' }, { id: 'p4', name: 'מצפה רמון' }],
  jobTypes: [{ id: 'j1', name: 'החלפת אנטנה' }, { id: 'j2', name: 'תחזוקת מצלמות' }],
  workKinds: [],
  postponeReasons: [],
  assistantNotes: [],
  departments: [],
  assistantExamples: [],
}

// Confirmed requests that Claude handled, as the app keeps them on a yes.
const ex = (said: string, p: Parameters<typeof normalizeProposal>[0], asked = [said]): AssistantExample => ({
  id: said,
  said,
  did: '',
  createdAt: '2026-11-06T09:00:00.000Z', // Friday: "מחר" then = 11-07
  action: exampleAction(normalizeProposal(p), asked),
})
const JOB_EXAMPLES = [
  ex('תפתח עבודה מחר לילה באילת אתר 123 החלפת אנטנה שני מטפסים', {
    jobs: [{ date: '2026-11-07', shiftKindId: 's2', location: 'אילת אתר 123', jobDescription: 'החלפת אנטנה', staffing: [{ roleId: 'r1', count: 2 }] }],
  }),
  ex('תפתח עבודה מחר עבודת יום בדימונה 556 תחזוקת מצלמות טכנאי מצלמות אחד ותשבץ לי מישהו', {
    jobs: [{ date: '2026-11-07', shiftKindId: 's1', location: 'דימונה 556', jobDescription: 'תחזוקת מצלמות', staffing: [{ roleId: 'r4', count: 1 }], autoAssign: true }],
  }),
]
const SICK_EXAMPLE = ex('אלי חולה היום', { editWorkers: [{ workerId: 'w3', status: 'sick', sickUntil: '2026-11-06' }] })

const data = (over: Partial<AppData> = {}): AppData => ({ ...base, assistantExamples: [...JOB_EXAMPLES, SICK_EXAMPLE], ...over })
const run = (said: string, d = data()) => handleFree(said, d, learn(d.assistantExamples, d), NOW)
const job = (r: Local) => (r?.kind === 'propose' ? r.proposal.jobs[0] : null)

describe('fixed commands', () => {
  it('opens screens and the assistant buttons', () => {
    expect(run('תפתח לי את היומן')).toMatchObject({ kind: 'open', screen: 'calendar' })
    expect(run('לך ליומן')).toMatchObject({ kind: 'open', screen: 'calendar' })
    expect(run('תראה לי את רשימת העובדים')).toMatchObject({ kind: 'open', screen: 'workers' })
    expect(run('תשתף את השבוע בווטסאפ')).toMatchObject({ kind: 'open', hint: 'shareWeek' })
    expect(run('תבקש אילוצים מהעובדים')).toMatchObject({ kind: 'open', hint: 'requestConstraints', screen: 'workers' })
  })

  it('says who works on a day, from the data', () => {
    const d = data({ shifts: [shift('a', '2026-11-08', 'ערד 17', [['w1', 'r1'], ['w2', 'r1']], ['r1', 'r1'])] })
    expect(run('מי עובד מחר?', d)).toEqual({ kind: 'say', text: 'מחר יש עבודה אחת. יום בערד 17: דני לוי, יוסי כהן.' })
    expect(run('מי עובד ביום שלישי', d)).toEqual({ kind: 'say', text: 'ביום שלישי 10.11 אין עבודות.' })
  })
})

describe('jobs learned from Claude', () => {
  it('learns the alias "מטפס" from what Claude did', () => {
    expect(learn(data().assistantExamples, data()).aliases['מטפס']).toBe('r1')
  })

  it('opens a new job said the way a learned one was, with other details', () => {
    expect(job(run('תפתח עבודה ביום שלישי לילה בערד 17 החלפת אנטנה שלושה מטפסים'))).toMatchObject({
      date: '2026-11-10', shiftKindId: 's2', location: 'ערד 17', jobDescription: 'החלפת אנטנה', staffing: [{ roleId: 'r1', count: 3 }], autoAssign: false,
    })
    expect(job(run('תפתח עבודה בשני יום בדימונה 556 החלפת כבלים שני חשמלאים וטפסן ותשבץ'))).toMatchObject({
      date: '2026-11-09', shiftKindId: 's1', location: 'דימונה 556', jobDescription: 'החלפת כבלים', staffing: [{ roleId: 'r2', count: 2 }, { roleId: 'r1', count: 1 }], autoAssign: true,
    })
  })

  it('the proposal it makes is valid and says what will be done', () => {
    const r = run('תפתח עבודה מחר לילה במצפה רמון החלפת אנטנה שני מטפסים')
    expect(r?.kind).toBe('propose')
    if (r?.kind !== 'propose') return
    expect(proposalErrors(r.proposal, data())).toEqual([])
    expect(r.proposal.summary).toBe('עבודה חדשה: לילה מחר, במצפה רמון, החלפת אנטנה. צריך 2 טפסן. לאשר, או שיש עוד תיקון?')
  })

  it('asks for a missing detail, then finishes with the answer', () => {
    const d = data()
    const L = learn(d.assistantExamples, d)
    const first = handleFree('תפתח עבודה לילה בערד 17 החלפת אנטנה שני מטפסים', d, L, NOW)
    expect(first).toMatchObject({ kind: 'ask', question: 'באיזה יום?' })
    if (first?.kind !== 'ask') return
    const next = continueJob('ביום ראשון', first.pending, d, L, NOW)
    expect(job(next)).toMatchObject({ date: '2026-11-08', location: 'ערד 17' })
    // An answer that is not an answer goes to Claude.
    expect(continueJob('דני חולה', first.pending, d, L, NOW)).toBeNull()
  })

  it('sends to Claude whatever it did not learn', () => {
    for (const s of [
      'דני חולה, הוא לא יכול לצאת ביום ראשון לאילת. מה עושים?',
      'תזכור שאבי לא עושה לילות בכלל',
      'מי בדרך כלל עובד באילת?',
      'תעביר את העבודה של מחר בדימונה 556 ליום שלישי',
      'תסגור את העבודה באילת אתר 123, הסתיימה',
      'תמחק את העבודה של מחר בערד 17',
      'תפתח עבודה מחר לילה באילת אתר 123 החלפת אנטנה עם דני ויוסי',
      'עבודה חדשה מחר לילה בערד 17 החלפת אנטנה שני מטפסים',
      'תפתח עבודה מחר לילה בבאר שבע החלפת אנטנה שני מטפסים', // a place not in the lists
      'כמה מטפסים יש לי מחר',
      'מי עובד מחר באילת',
    ])
      expect([s, run(s)]).toEqual([s, null])
  })

  it('learns nothing before Claude did it once', () => {
    expect(run('תפתח עבודה מחר לילה בערד 17 החלפת אנטנה שני מטפסים', data({ assistantExamples: [] }))).toBeNull()
    expect(run('יוסי חולה היום', data({ assistantExamples: [] }))).toBeNull()
  })
})

describe('a sick worker, learned from Claude', () => {
  it('marks him sick when he has no job', () => {
    const r = run('יוסי חולה היום')
    expect(r?.kind).toBe('propose')
    if (r?.kind !== 'propose') return
    expect(r.proposal.editWorkers).toEqual([expect.objectContaining({ workerId: 'w2', status: 'sick', sickUntil: '2026-11-07' })])
    expect(r.proposal.summary).toBe('יוסי כהן חולה עד היום. הוא לא משובץ לעבודה בימים האלה. לאשר, או שיש עוד תיקון?')
  })

  it('when he is in a job, offers a free replacement at once', () => {
    const d = data({ shifts: [shift('a', '2026-11-08', 'ערד 17', [['w2', 'r1']], ['r1'])] })
    const r = run('יוסי חולה עד מחר', d)
    expect(r?.kind).toBe('advise')
    if (r?.kind !== 'advise') return
    expect(r.spoken).toMatch(/^יוסי משובץ מחר בעבודה בערד 17\. .+ לעשות את זה, או פתרון אחר\?$/)
    expect(r.options.length).toBeGreaterThan(0)
    expect(r.extra.editWorkers[0]).toMatchObject({ workerId: 'w2', status: 'sick', sickUntil: '2026-11-08' })
  })

  it('anything more than "<name> is sick <when>" goes to Claude', () => {
    expect(run('יוסי חולה ודני בחופש')).toBeNull()
    expect(run('יוסי ודני חולים היום')).toBeNull()
  })
})

describe('what a confirmed proposal teaches', () => {
  it('only one new job, or one worker sick', () => {
    expect(exampleAction(normalizeProposal({ jobs: [{ date: '2026-11-08' }], workers: [{ firstName: 'x' }] }), ['a'])).toBeUndefined()
    expect(exampleAction(normalizeProposal({ jobs: [{}, {}] }), ['a'])).toBeUndefined()
    expect(exampleAction(normalizeProposal({ editWorkers: [{ workerId: 'w1', status: 'sick', sickUntil: '2026-11-08' }], setCrews: [{ shiftId: 'a', crew: [] }] }), ['דני חולה', 'פתרון 1'])).toEqual({
      type: 'sick', said: 'דני חולה', workerId: 'w1', until: '2026-11-08',
    })
  })
})

describe('names as speech recognition writes them', () => {
  it('learns from "<first> <last> חולה" and handles another worker said with a slightly different last name', () => {
    const d = data({
      assistantExamples: [ex('אבי אלפסי חולה מחר', { editWorkers: [{ workerId: 'w6', status: 'sick', sickUntil: '2026-11-07' }], lessons: ['x'], rememberNotes: ['y'] })],
    })
    const r = run('משה תורגמן חולה היום', d)
    expect(r?.kind).toBe('propose')
    if (r?.kind === 'propose') expect(r.proposal.editWorkers[0]).toMatchObject({ workerId: 'w5', status: 'sick', sickUntil: '2026-11-07' })
  })

  it('a last name too different is not taken as his', () => {
    expect(run('משה גולדברג חולה היום')).toBeNull()
  })
})
