import { describe, expect, it } from 'vitest'
import { claudePart, continueJob, continueWho, exampleAction, handleFree, knownResult, learn, pickedOption, sickPlan, splitFree, whyNotFree, type Local } from './freeCommands'
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
    // Assigning people needs a date.
    const first = handleFree('תפתח עבודה לילה בערד 17 החלפת אנטנה שני מטפסים ותשבץ', d, L, NOW)
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
      'תפתח עבודה מחר לילה בבאר שבע החלפת אנטנה שני מטפסים', // a place not in the lists
      'כמה מטפסים יש לי מחר',
      'מי עובד מחר באילת',
    ])
      expect([s, run(s)]).toEqual([s, null])
  })

  it('a role word it never saw goes to Claude before Claude taught it', () => {
    // "מטפסים" is learned from Claude (alias of טפסן); before that it is not understood.
    expect(run('תפתח עבודה מחר לילה בערד 17 החלפת אנטנה שני מטפסים', data({ assistantExamples: [] }))).toBeNull()
    expect(job(run('תפתח עבודה מחר לילה בערד 17 החלפת אנטנה שני טפסנים', data({ assistantExamples: [] })))).toMatchObject({ staffing: [{ roleId: 'r1', count: 2 }] })
  })
})

describe('a new job, any phrasing, from the first time', () => {
  const none = (said: string) => run(said, data({ assistantExamples: [] }))

  it('understands other verbs, with nothing learned', () => {
    for (const s of [
      'תייצר לי עבודה מחר לילה בערד 17 החלפת אנטנה',
      'תכניס לי עבודה מחר לילה בערד 17 החלפת אנטנה',
      'תוסיף עבודה מחר לילה בערד 17 החלפת אנטנה',
      'תרשום עבודה מחר לילה בערד 17 החלפת אנטנה',
      'עבודה חדשה מחר לילה בערד 17 החלפת אנטנה',
      'יש לי עבודה חדשה מחר לילה בערד 17 החלפת אנטנה',
      'תקבע עבודה לילה מחר החלפת אנטנה בערד 17',
      'בבקשה תפתחי עבודה חדשה מחר לילה בערד 17 החלפת אנטנה',
    ])
      expect([s, job(none(s))]).toEqual([s, expect.objectContaining({ date: '2026-11-08', shiftKindId: 's2', location: 'ערד 17', jobDescription: 'החלפת אנטנה', autoAssign: false })])
  })

  it('with no date the job goes to the לשיבוץ list, and the proposal is valid', () => {
    const d = data({ assistantExamples: [] })
    const r = none('תכניס לי עבודה לילה בערד 17 החלפת אנטנה שני טפסנים')
    expect(job(r)).toMatchObject({ date: '', location: 'ערד 17', staffing: [{ roleId: 'r1', count: 2 }] })
    if (r?.kind !== 'propose') return
    expect(proposalErrors(r.proposal, d)).toEqual([])
    expect(r.proposal.summary).toBe('עבודה חדשה: לילה, בלי תאריך, לרשימת לשיבוץ, בערד 17, החלפת אנטנה. צריך 2 טפסן. לאשר, או שיש עוד תיקון?')
  })

  it('partial details are fine: a place, or a description, is enough', () => {
    expect(job(none('תוסיף עבודה יום בדימונה 556'))).toMatchObject({ date: '', location: 'דימונה 556', jobDescription: '', staffing: [] })
    expect(job(none('תפתח עבודה יום מחר תחזוקת מצלמות'))).toMatchObject({ date: '2026-11-08', location: '', jobDescription: 'תחזוקת מצלמות' })
    expect(job(none('תרשום עבודת לילה החלפת כבלים'))).toMatchObject({ location: '', jobDescription: 'החלפת כבלים' })
    const r = none('תוסיף עבודה יום בדימונה 556')
    if (r?.kind === 'propose') expect(r.proposal.summary).toBe('עבודה חדשה: יום, בלי תאריך, לרשימת לשיבוץ, בדימונה 556. לאשר, או שיש עוד תיקון?')
  })

  it('asks the kind when not said, and where when neither a place nor a description was said', () => {
    const d = data({ assistantExamples: [] })
    const L = learn([], d)
    const a = handleFree('תפתח עבודה מחר בערד 17', d, L, NOW)
    expect(a).toMatchObject({ kind: 'ask', question: 'איזו עבודה, יום, לילה?' })
    if (a?.kind !== 'ask') return
    expect(job(continueJob('לילה', a.pending, d, L, NOW))).toMatchObject({ date: '2026-11-08', shiftKindId: 's2', location: 'ערד 17' })
    const b = handleFree('תייצר לי עבודה חדשה לילה', d, L, NOW)
    expect(b).toMatchObject({ kind: 'ask', question: 'איפה?' })
    if (b?.kind !== 'ask') return
    expect(job(continueJob('במצפה רמון', b.pending, d, L, NOW))).toMatchObject({ date: '', location: 'מצפה רמון' })
    // With one kind of job only, that is the kind.
    const one = data({ assistantExamples: [], shiftDefinitions: [base.shiftDefinitions[0]] })
    expect(job(run('תפתח עבודה מחר בערד 17', one))).toMatchObject({ shiftKindId: 's1' })
  })

  it('anything else about jobs still goes to Claude', () => {
    for (const s of [
      'תפתח את העבודה של מחר', // a job that exists
      'תוסיף לעבודה בערד 17 עוד טפסן',
      'תפתח שתי עבודות מחר בערד 17',
      'תוסיף עבודה מחר לילה בערד 17 עם דני',
      'תוסיף עבודה מחר לילה בערד 17 מה צריך',
      'תכניס עבודה מחר בערד 17 החלפת אנטנה ותעביר את דני',
      'תוסיף עבודה מחר בערד 17 לילה 3',
      'מה העבודה מחר בערד 17',
      'עבודה מחר בערד 17', // no verb: maybe a question
      'תכניס עבודה מחר לילה החלפת אנטנה בבאר שבע', // a place not in the lists, with a known description
    ])
      expect([s, none(s)]).toEqual([s, null])
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

describe('sick tomorrow', () => {
  it('is an absence tomorrow, not sick from today', () => {
    const r = run('יוסי חולה מחר')
    expect(r?.kind).toBe('propose')
    if (r?.kind !== 'propose') return
    expect(r.proposal.editWorkers).toEqual([])
    expect(r.proposal.addConstraints).toEqual([{ workerId: 'w2', from: '2026-11-08', to: '2026-11-08', nightsOnly: false, note: 'מחלה', kind: '' }])
    expect(r.proposal.summary).toBe('יוסי כהן חולה מחר. הוא לא משובץ לעבודה בימים האלה. לאשר, או שיש עוד תיקון?')
  })

  it('"עד מחר" is sick from today', () => {
    const r = run('יוסי חולה עד מחר')
    if (r?.kind === 'propose') expect(r.proposal.editWorkers[0]).toMatchObject({ status: 'sick', sickUntil: '2026-11-08' })
    else throw new Error(JSON.stringify(r))
  })

  it('a sickness ahead that Claude saved as an absence is learned too', () => {
    const d = data({ assistantExamples: [ex('אבי אלפסי חולה מחר', { addConstraints: [{ workerId: 'w6', from: '2026-11-07', to: '2026-11-07', note: 'מחלה' }] })] })
    expect(run('דני חולה מחרתיים', d)?.kind).toBe('propose')
  })
})

describe('sick from the first time, and picking by voice', () => {
  it('"<worker> חולה" works with nothing learned yet', () => {
    const d = data({ assistantExamples: [] })
    expect(run('אלי פרץ חולה מחר', d)?.kind).toBe('propose')
  })

  it('the sickness of the first sentence goes with a replacement Claude ranked', () => {
    const d = data({ assistantExamples: [] })
    const plan = sickPlan('אלי פרץ חולה מחר', d, learn([], d), NOW)
    expect(plan?.extra.addConstraints).toEqual([{ workerId: 'w3', from: '2026-11-08', to: '2026-11-08', nightsOnly: false, note: 'מחלה', kind: '' }])
    expect(sickPlan('אלי פרץ חולה מחר ותבדוק מי פנוי', d, learn([], d), NOW)).toBeNull()
  })

  it('understands a spoken pick', () => {
    expect(pickedOption('כן', 3)).toBe(0)
    expect(pickedOption('תעשה את זה', 3)).toBe(0)
    expect(pickedOption('הראשון', 3)).toBe(0)
    expect(pickedOption('פתרון 2', 3)).toBe(1)
    expect(pickedOption('את השני', 3)).toBe(1)
    expect(pickedOption('השלישי', 2)).toBeNull()
    expect(pickedOption('לא, תחפש מישהו אחר', 3)).toBeNull()
  })
})

describe('worker names said a little differently (typos, speech recognition, English)', () => {
  const sickOf = (r: Local) => (r?.kind === 'propose' ? r.proposal.editWorkers[0]?.workerId ?? r.proposal.addConstraints[0]?.workerId : null)

  it('finds the closest worker', () => {
    expect(sickOf(run('יוסיי חולה היום'))).toBe('w2') // a letter too many
    expect(sickOf(run('דאני חולה היום'))).toBe('w1') // a vowel letter added
    expect(sickOf(run('משה טורגמן חולה היום'))).toBe('w5') // ט for ת in the last name
    expect(sickOf(run('Yossi חולה היום'))).toBe('w2') // written in English
    expect(sickOf(run('moshe חולה היום'))).toBe('w5')
    expect(sickOf(run('ליוסי חולה היום'))).toBe('w2')
  })

  it('a card written in English is found by its Hebrew sound', () => {
    const d = data({ workers: [...base.workers, w('w7', 'David', 'Smith', ['r1'])] })
    expect(sickOf(run('דוד חולה היום', d))).toBe('w7')
    expect(sickOf(run('דייויד סמית חולה היום', d))).toBe('w7')
  })

  it('says there is no such worker when no name is close enough, and never guesses', () => {
    for (const [s, name] of [['גלעד חולה היום', 'גלעד'], ['רונן חולה היום', 'רונן'], ['אמי חולה מחר', 'אמי']])
      expect(run(s)).toEqual({ kind: 'say', text: `לא מצאתי עובד בשם ${name}. אפשר לומר שוב, עם השם כמו שהוא ברשימת העובדים.` })
  })

  it('asks which one when two workers are about equally close', () => {
    const d = data({ workers: [...base.workers, w('w8', 'יוסי', 'לוי', ['r1'])] })
    const r = run('יוסי חולה היום', d)
    expect(r).toMatchObject({ kind: 'which', question: 'למי התכוונת, יוסי כהן או יוסי לוי?' })
    if (r?.kind !== 'which') return
    const L = learn(d.assistantExamples, d)
    expect(sickOf(continueWho('לוי', r.pending, d, L, NOW)?.local ?? null)).toBe('w8')
    expect(sickOf(continueWho('יוסי כהן', r.pending, d, L, NOW)?.local ?? null)).toBe('w2')
    expect(sickOf(continueWho('השני', r.pending, d, L, NOW)?.local ?? null)).toBe('w8')
    expect(continueWho('יוסי כהן', r.pending, d, L, NOW)?.text).toBe('יוסי כהן חולה היום')
    expect(continueWho('דני', r.pending, d, L, NOW)).toBeNull() // not one of them: Claude
    expect(continueWho('כן', r.pending, d, L, NOW)).toBeNull()
    // The last name said decides at once.
    expect(sickOf(run('יוסי לוי חולה היום', d))).toBe('w8')
  })

  it('asks also when a misheard name is equally near two', () => {
    const d = data({ workers: [...base.workers, w('w9', 'אלון', 'שחר', ['r1']), w('w10', 'אילן', 'גבאי', ['r1'])] })
    expect(run('אלן חולה היום', d)).toMatchObject({ kind: 'which', question: 'למי התכוונת, אלון שחר או אילן גבאי?', pending: { ids: ['w9', 'w10'] } })
    expect(sickOf(run('אילן חולה היום', d))).toBe('w10') // the exact name wins
    expect(sickOf(run('אלן גבאי חולה היום', d))).toBe('w10') // the last name decides
  })

  it('ordinary words are not names', () => {
    expect(run('הילד שלי חולה היום')).toBeNull()
    expect(run('מישהו חולה היום')).toBeNull()
    expect(run('אני חולה היום')).toBeNull()
    expect(run('תפתח עבודה מחר לילה באילת אתר 123 החלפת אנטנה עם דאני')).toBeNull() // a worker in a job: Claude
  })
})

describe('learned patterns keep values as slots', () => {
  it('a date in digits and a new place in the example are not part of the template', () => {
    const d = data({
      assistantExamples: [
        ex('תפתח עבודה ב-15.11 לילה בבאר שבע 9 החלפת אנטנה שני מטפסים', {
          jobs: [{ date: '2026-11-15', shiftKindId: 's2', location: 'באר שבע 9', jobDescription: 'החלפת אנטנה', staffing: [{ roleId: 'r1', count: 2 }] }],
        }),
      ],
    })
    expect(learn(d.assistantExamples, d).job.words).toEqual([['תפתח', 'עבודה']])
    const r = job(run('תפתח עבודה ב-20.11 יום בערד 17 תחזוקת מצלמות 3 מטפסים', d))
    expect(r).toMatchObject({ date: '2026-11-20', shiftKindId: 's1', location: 'ערד 17', jobDescription: 'תחזוקת מצלמות', staffing: [{ roleId: 'r1', count: 3 }] })
  })

  it('a misspelled name in the example is a slot too', () => {
    const d = data({ assistantExamples: [ex('יוסיי חולה עד מחר', { editWorkers: [{ workerId: 'w2', status: 'sick', sickUntil: '2026-11-07' }] })] })
    expect(learn(d.assistantExamples, d).sick.words[0]).toEqual(['חולה'])
  })

  it('reads dates in digits and "בעוד"', () => {
    const until = (r: Local) => (r?.kind === 'propose' ? r.proposal.editWorkers[0]?.sickUntil ?? r.proposal.addConstraints[0]?.from : null)
    expect(until(run('יוסי חולה עד 10.11'))).toBe('2026-11-10')
    expect(until(run('יוסי חולה בעוד יומיים'))).toBe('2026-11-09')
    expect(run('יוסי חולה בעוד יומיים')).toMatchObject({ kind: 'propose', proposal: { editWorkers: [], addConstraints: [{ workerId: 'w2', from: '2026-11-09' }] } })
    expect(until(run('יוסי חולה עד 3.1'))).toBe('2027-01-03') // the next 3.1
    expect(run('יוסי חולה עד 31.2')).toBeNull() // not a real date: Claude
  })
})

describe('a new worker, from the first time', () => {
  const none = (said: string) => run(said, data({ assistantExamples: [] }))
  const added = (r: Local) => (r?.kind === 'propose' ? r.proposal.workers[0] : null)

  it('adds a worker said in many ways, with a phone and a role', () => {
    for (const [s, want] of [
      ['תוסיף עובד חדש משה גולן 050-1234567', { firstName: 'משה', lastName: 'גולן', mobilePhone: '0501234567', roleIds: [] }],
      ['תוסיף לי עובד בשם שמעון ביטון טלפון 0521234567', { firstName: 'שמעון', lastName: 'ביטון', mobilePhone: '0521234567' }],
      ['תכניס עובד חדש אורי דהן 054 123 4567 הוא חשמלאי', { firstName: 'אורי', lastName: 'דהן', mobilePhone: '0541234567', roleIds: ['r2'] }],
      ['תרשום עובדת חדשה מירב שושן הטלפון שלה 0531112222', { firstName: 'מירב', lastName: 'שושן', mobilePhone: '0531112222' }],
      ['תוסיף עובד טפסן קובי אזולאי 0507654321', { firstName: 'קובי', lastName: 'אזולאי', roleIds: ['r1'] }],
      ['תוסיף עובד חדש רפאל', { firstName: 'רפאל', lastName: '', mobilePhone: '' }],
      ['הוסף עובד חדש בן חיים אלמוג נייד +972501234567', { firstName: 'בן', lastName: 'חיים אלמוג', mobilePhone: '+972501234567' }],
    ] as const)
      expect([s, added(none(s))]).toEqual([s, expect.objectContaining(want)])
  })

  it('the proposal is valid and says what will be saved', () => {
    const r = none('תכניס עובד חדש אורי דהן 054-1234567 חשמלאי')
    if (r?.kind !== 'propose') throw new Error(JSON.stringify(r))
    expect(proposalErrors(r.proposal, data())).toEqual([])
    expect(r.proposal.summary).toBe('עובד חדש: אורי דהן, טלפון 0541234567, חשמלאי. לאשר, או שיש עוד תיקון?')
  })

  it('a name already in the list is said back, free', () => {
    expect(none('תוסיף עובד חדש יוסי כהן 0501234567')).toMatchObject({ kind: 'say', text: expect.stringContaining('כבר יש ברשימה עובד בשם יוסי כהן') })
  })

  it('anything more goes to Claude', () => {
    for (const s of [
      'תוסיף שני עובדים משה גולן 0501234567 ושמעון ביטון 0521234567',
      'תוסיף לעובד יוסי טלפון 0501234567', // an existing worker
      'תוסיף עובד חדש משה גולן מחר לילה', // a date and a kind
      'תוסיף עובד חדש מה השם שלו',
      'תוסיף עובד חדש 0501234567', // no name
      'תוסיף עובד חדש משה גולן 0501234567 ותשבץ אותו מחר',
      'מי העובד החדש',
    ])
      expect([s, none(s)?.kind === 'propose' ? 'propose' : none(s)]).toEqual([s, null])
  })
})

describe('why a sentence went to Claude (the log)', () => {
  const why = (said: string, d = data()) => whyNotFree(said, d, learn(d.assistantExamples, d), NOW)

  it('names an action not learned yet, and what was understood', () => {
    const r = why('תעביר את דני לעבודה בערד 17 ביום ראשון')
    expect(r.reason).toContain('a job that exists')
    expect(r.understood).toContain('workers: דני')
    expect(r.understood).toContain('place: ערד 17')
    expect(r.understood).toContain('date: 2026-11-08')
    expect(r.understood).toContain('"תעביר"')
  })

  it('names the words that stopped a learned sickness', () => {
    expect(why('יוסי חולה מאוד היום').reason).toBe('sick: words not learned for sickness: "מאוד"')
    expect(why('יוסי ודני חולים היום').reason).toMatch(/^(?:sick|no learned)/)
    expect(why('יוסי חולה היום בערד 17').reason).toContain('also has a place')
  })

  it('says a job that names a worker is not learned yet', () => {
    expect(why('תפתח עבודה מחר לילה בערד 17 החלפת אנטנה שני מטפסים עם דני').reason).toContain('names a worker')
  })

  it('never claims a reason for what the free path does do', () => {
    // A sanity check: these are done free, so they never reach the log.
    expect(run('יוסי חולה היום')).not.toBeNull()
    expect(run('תפתח עבודה מחר לילה בערד 17 החלפת אנטנה שני מטפסים')).not.toBeNull()
  })
})

describe('one long sentence with several requests', () => {
  const split = (said: string, d = data()) => splitFree(said, d, learn(d.assistantExamples, d), NOW)
  const kinds = (s: ReturnType<typeof split>) => s && { known: s.known.map((k) => [k.text, k.local.kind]), unknown: s.unknown }

  it('does every known part free and sends nothing when all are known', () => {
    const s = split('יוסי חולה היום ותפתח עבודה ביום שלישי לילה בערד 17')
    expect(kinds(s)).toEqual({ known: [['יוסי חולה היום', 'propose'], ['תפתח עבודה ביום שלישי לילה בערד 17', 'propose']], unknown: [] })
    const { proposal } = knownResult(s!)
    expect(proposal!.jobs).toHaveLength(1)
    expect(proposal!.editWorkers[0]).toMatchObject({ workerId: 'w2', status: 'sick' })
    expect(proposal!.summary.match(/לאשר/g)).toHaveLength(1)
    expect(proposalErrors(proposal!, data())).toEqual([])
  })

  it('two sick workers said with "ו" are two requests when each one is known', () => {
    expect(kinds(split('יוסי חולה היום ודני חולה היום'))).toEqual({ known: [['יוסי חולה היום', 'propose'], ['דני חולה היום', 'propose']], unknown: [] })
  })

  it('sends only the unknown part to Claude, with the whole sentence as context', () => {
    const said = 'תפתח עבודה ביום שלישי לילה בערד 17, ותבדוק למה רון לא שובץ בשבוע שעבר'
    const s = split(said)
    expect(kinds(s)).toEqual({ known: [['תפתח עבודה ביום שלישי לילה בערד 17', 'propose']], unknown: ['תבדוק למה רון לא שובץ בשבוע שעבר'] })
    const turn = claudePart(s!, said)
    expect(turn.startsWith('תבדוק למה רון לא שובץ בשבוע שעבר')).toBe(true)
    expect(turn).toContain('אל תעשה אותם')
    expect(turn).toContain(said)
  })

  it('a question about the day is said, and joins with a job', () => {
    const d = data({ shifts: [shift('a', '2026-11-08', 'ערד 17', [['w1', 'r1']], ['r1'])] })
    const s = split('מי עובד מחר וגם תפתח עבודה ביום שלישי בערד 17 לילה', d)
    expect(kinds(s)).toEqual({ known: [['מי עובד מחר', 'say'], ['תפתח עבודה ביום שלישי בערד 17 לילה', 'propose']], unknown: [] })
    expect(knownResult(s!).says).toEqual(['מחר יש עבודה אחת. יום בערד 17: דני לוי.'])
  })

  it('"ותשבץ" stays part of the job, and a job with "ו" in its words is not cut', () => {
    expect(split('תפתח עבודה מחר לילה בערד 17 ותשבץ לי מישהו')).toBeNull()
    expect(split('יוסי ודני חולים היום')).toBeNull()
  })

  it('a correction or a lone detail sends the whole sentence to Claude', () => {
    expect(split('תפתח עבודה מחר לילה בערד 17, לא, ביום שלישי')).toBeNull()
    expect(split('תפתח עבודה מחר לילה בערד 17, ביום שלישי')).toBeNull()
    expect(split('יוסי חולה היום, בערד 17')).toBeNull()
  })

  it('one request, or nothing known, is not split', () => {
    expect(split('תפתח עבודה מחר לילה בערד 17')).toBeNull()
    expect(split('תעביר את רון לעבודה בערד, ותבדוק מי פנוי ביום שלישי')).toBeNull()
  })

  it('a part the app would ask about is left to Claude', () => {
    // No kind said: the app would ask "איזו עבודה". In a long sentence that part goes to Claude.
    expect(kinds(split('יוסי חולה היום ותפתח עבודה בערד 17'))).toEqual({ known: [['יוסי חולה היום', 'propose']], unknown: ['תפתח עבודה בערד 17'] })
  })
})
