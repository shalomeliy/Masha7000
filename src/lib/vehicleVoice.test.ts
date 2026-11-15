import { describe, expect, it } from 'vitest'
import { applyProposal, normalizeProposal, proposalErrors, proposalVehicles, snapshot, summaryWith, type AppData } from './assistant'
import { carFix, continueCar, handleFree, learn, type Local } from './freeCommands'
import { numberAt, pickCar, readCar, saysCar } from './vehicleRef'
import type { ShiftRecord, Vehicle } from '../types/models'

// Vehicles named by the last 3 digits of the plate (the user's request, 2026-11-15).

const NOW = new Date('2026-11-07T10:00:00') // Saturday: מחר = 11-08
const car = (id: string, plate: string, make: string, model: string): Vehicle => ({ id, values: { plate, make, model } })
const VEHICLES = [
  car('v1', '12-683-45', 'Isuzu', 'D-Max 4X4'),
  car('v2', '123-45-678', 'סיטרואן', 'ברלינגו'),
  car('v3', '55-118-12', 'Dacia', 'Dokker'),
  car('v4', '11-555-55', 'Toyota', 'Hilux'),
  car('v5', '223-33-555', 'Ford', 'Transit'),
  car('v6', '77-100-77', 'Isuzu', 'D-Max'),
]
const shift = (id: string, date: string, location: string, over: Partial<ShiftRecord> = {}): ShiftRecord => ({ id, date, shiftDefinitionId: 's1', location, jobDescription: 'תחזוקה', crew: [], staffing: [{}], ...over })

const base: AppData = {
  certifications: [{ id: 'r1', name: 'טפסן' }],
  workers: [{ id: 'w1', firstName: 'דני', lastName: 'לוי', certificationIds: ['r1'], constraints: [] }],
  shiftDefinitions: [
    { id: 's1', name: 'יום', requiredCertificationIds: [], startTime: '07:00', endTime: '16:00' },
    { id: 's2', name: 'לילה', requiredCertificationIds: [], startTime: '07:00', endTime: '16:00', endsNextDay: true },
  ],
  shifts: [],
  pendingJobs: [],
  places: [{ id: 'p3', name: 'ערד 17' }, { id: 'p2', name: 'דימונה 556' }],
  jobTypes: [{ id: 'j1', name: 'החלפת אנטנה' }],
  workKinds: [],
  postponeReasons: [],
  assistantNotes: [],
  departments: [],
  assistantExamples: [],
  vehicles: VEHICLES,
}
const data = (over: Partial<AppData> = {}): AppData => ({ ...base, ...over })
const run = (said: string, d = data()) => handleFree(said, d, learn(d.assistantExamples, d), NOW)
const proposal = (r: Local) => (r?.kind === 'propose' ? r.proposal : null)
const jobCar = (r: Local) => proposal(r)?.jobs[0]?.vehicleId

describe('numbers said in words', () => {
  const n = (s: string) => numberAt(s.split(' '), 0)?.digits
  it('reads digits, digit words and whole numbers', () => {
    expect(n('345')).toBe('345')
    expect(n('ה-345')).toBe('345')
    expect(n('3-4-5')).toBe('345')
    expect(n('3 4 5')).toBe('345')
    expect(n('12-345-67')).toBe('1234567')
    expect(n('שלוש ארבע חמש')).toBe('345')
    expect(n('שש שבע שמונה')).toBe('678')
    expect(n('אפס שבע שבע')).toBe('077')
    expect(n('שלוש מאות ארבעים וחמש')).toBe('345')
    expect(n('שש מאות שבעים ושמונה')).toBe('678')
    expect(n('שמונה מאות ושתים עשרה')).toBe('812')
    expect(n('חמש מאות חמישים וחמש')).toBe('555')
    expect(n('מאה')).toBe('100')
  })
  it('stops where the number ends', () => {
    expect(numberAt('345 2 טפסנים'.split(' '), 0)).toEqual({ digits: '345', n: 1 })
    expect(numberAt('שלוש ארבע חמש שני טפסנים'.split(' '), 0)).toEqual({ digits: '345', n: 3 })
    expect(numberAt('שלוש מאות ארבעים וחמש שני'.split(' '), 0)).toEqual({ digits: '345', n: 4 })
    expect(numberAt('מחר'.split(' '), 0)).toBeNull()
  })
})

describe('finding the vehicle said', () => {
  const ref = (s: string) => {
    const ws = s.split(' ')
    return readCar(ws, ws.map(() => false), VEHICLES, () => false)
  }
  it('by the last 3 digits, in any form', () => {
    for (const s of ['רכב 678', 'את רכב 6-7-8', 'הרכב שמספרו נגמר ב-678', 'רכב שש שבע שמונה', 'רכב שש מאות שבעים ושמונה', 'ברכב מספר 678', 'רכב 123-45-678']) expect(ref(s)?.ids, s).toEqual(['v2'])
  })
  it('by digits next to the make or model, without "רכב"', () => {
    expect(ref('את הברלינגו 678')?.ids).toEqual(['v2'])
    expect(ref('את 345 דימקס')?.ids).toEqual(['v1'])
  })
  it('a make or model that fits is no correction; one that does not is', () => {
    expect(ref('רכב 345 איסוזו')).toMatchObject({ ids: ['v1'], wrong: [] })
    expect(ref('רכב 345 דימקס')).toMatchObject({ ids: ['v1'], wrong: [] })
    expect(ref("רכב 345 דאצ'יה")).toMatchObject({ ids: ['v1'], wrong: ["דאצ'יה"] })
    expect(ref('רכב 345 דאציה')).toMatchObject({ ids: ['v1'], wrong: ['דאציה'] })
  })
  it('the make or model decides between two with the same digits', () => {
    expect(ref('רכב 555')?.ids).toEqual(['v4', 'v5'])
    expect(ref('רכב 555 טויוטה')?.ids).toEqual(['v4'])
    expect(ref('הטרנזיט 555')?.ids).toEqual(['v5'])
  })
  it('the correction names the vehicle of the digits and where the one said is', () => {
    const r = ref("רכב 345 דאצ'יה")!
    expect(pickCar(r, VEHICLES)).toEqual({ kind: 'one', vehicle: VEHICLES[0], note: "שים לב, רכב 345 הוא Isuzu D-Max 4X4, לא דאצ'יה. רכב דאצ'יה אצלנו הוא 812." })
  })
  it('"רכב" alone or a plain number names no vehicle', () => {
    expect(ref('צריך רכב')).toBeUndefined()
    expect(ref('בדימונה 556')).toBeUndefined()
    expect(ref('שני טפסנים')).toBeUndefined()
  })
})

describe('a new job with a vehicle, free', () => {
  it('takes the vehicle of the 3 digits and says its digits, make and model', () => {
    const r = run('תפתח עבודת יום מחר בערד 17 החלפת אנטנה עם רכב 678')
    expect(jobCar(r)).toBe('v2')
    expect(proposal(r)?.summary).toBe('עבודה חדשה: יום מחר, בערד 17, החלפת אנטנה. רכב 678, סיטרואן ברלינגו. לאשר, או שיש עוד תיקון?')
  })
  it('the digits in words, or with dashes', () => {
    for (const s of ['תפתח עבודת יום מחר בערד 17 עם רכב שש שבע שמונה', 'תפתח עבודת יום מחר בערד 17 עם רכב שש מאות שבעים ושמונה', 'תפתח עבודת יום מחר בערד 17 עם רכב 6-7-8', 'תפתח עבודת יום ברכב 678 מחר בערד 17']) {
      expect(jobCar(run(s)), s).toBe('v2')
    }
  })
  it('corrects a make that is not that vehicle, and keeps the vehicle of the digits for the yes or the fix', () => {
    const r = run("תפתח עבודת יום מחר בערד 17 עם רכב 345 דאצ'יה")
    expect(jobCar(r)).toBe('v1')
    expect(proposal(r)?.summary).toMatch(/^שים לב, רכב 345 הוא Isuzu D-Max 4X4, לא דאצ'יה\. רכב דאצ'יה אצלנו הוא 812\. עבודה חדשה: .* רכב 345, Isuzu D-Max 4X4\./)
  })
  it('asks which when two vehicles fit, and goes on with the one picked', () => {
    const d = data()
    const r = run('תפתח עבודת יום מחר בערד 17 עם רכב 555', d)
    expect(r).toMatchObject({ kind: 'whichCar', question: 'יש 2 רכבים שמספר הרישוי שלהם נגמר ב-555: Toyota Hilux או Ford Transit. איזה מהם?' })
    if (r?.kind !== 'whichCar') throw new Error()
    const L = learn([], d)
    expect(jobCar(continueCar('הטויוטה', r.pending, d, L, NOW)!.local)).toBe('v4')
    expect(jobCar(continueCar('את הפורד', r.pending, d, L, NOW)!.local)).toBe('v5')
    expect(jobCar(continueCar('השני', r.pending, d, L, NOW)!.local)).toBe('v5')
    expect(continueCar('לא יודע', r.pending, d, L, NOW)).toBeNull()
  })
  it('two vehicles of one model: asked by their digits', () => {
    expect(run('תפתח עבודת יום מחר בערד 17 עם הרכב דימקס')).toMatchObject({ kind: 'whichCar', question: 'יש 2 רכבים דימקס: 345 Isuzu D-Max 4X4 או 077 Isuzu D-Max. איזה מהם?' })
  })
  it('no vehicle with those digits: says so, never a guess', () => {
    expect(run('תפתח עבודת יום מחר בערד 17 עם רכב 999')).toEqual({ kind: 'say', text: 'לא מצאתי רכב שמספר הרישוי שלו נגמר ב-999. אפשר לומר שוב את שלוש הספרות האחרונות, או לבדוק במסך הרכבים.' })
  })
  it('the vehicle is saved with its model', () => {
    const p = proposal(run('תפתח עבודת יום מחר בערד 17 עם רכב 678'))!
    expect(proposalErrors(p, data())).toEqual([])
    const out = applyProposal(p, data(), NOW)
    expect(out.data.shifts[0]).toMatchObject({ vehicleId: 'v2', vehicleModel: 'ברלינגו' })
    expect(out.report).toContain('הוספתי לעבודה בערד 17 את רכב 678, סיטרואן ברלינגו')
  })
})

describe('a vehicle for a job that exists, free', () => {
  const d = data({ shifts: [shift('a', '2026-11-08', 'ערד 17'), shift('b', '2026-11-09', 'דימונה 556', { vehicleId: 'v4' })] })
  it('by the place or the day of the one job', () => {
    for (const s of ['תוסיף לעבודה בערד 17 את רכב 678', 'תוסיף לעבודה מחר את רכב 678', 'תשים את רכב 678 בעבודה בערד']) {
      const p = proposal(run(s, d))
      expect(p?.editJobs, s).toEqual([expect.objectContaining({ id: 'a', vehicleId: 'v2' })])
      expect(p?.summary, s).toBe('לעבודה בערד 17 מחר אוסיף את רכב 678, סיטרואן ברלינגו. לאשר, או שיש עוד תיקון?')
    }
  })
  it('says the vehicle it replaces', () => {
    expect(proposal(run('תחליף לעבודה בדימונה את רכב 678', d))?.summary).toBe('לעבודה בדימונה 556 ביום שני 9.11 אוסיף את רכב 678, סיטרואן ברלינגו, במקום רכב 555, Toyota Hilux. לאשר, או שיש עוד תיקון?')
  })
  it('corrects a wrong make here too', () => {
    expect(proposal(run("תוסיף לעבודה בערד את רכב 345 דאצ'יה", d))?.summary).toMatch(/^שים לב, רכב 345 הוא Isuzu D-Max 4X4, לא דאצ'יה/)
  })
  it('saves only the vehicle, and says so', () => {
    const p = proposal(run('תוסיף לעבודה בערד 17 את רכב 678', d))!
    const out = applyProposal(p, d, NOW)
    expect(out.data.shifts.find((s) => s.id === 'a')).toMatchObject({ vehicleId: 'v2', vehicleModel: 'ברלינגו', location: 'ערד 17' })
    expect(out.report).toEqual(['הוספתי לעבודה בערד 17 את רכב 678, סיטרואן ברלינגו'])
  })
  it('no such job: says so', () => {
    expect(run('תוסיף לעבודה באילת את רכב 678', data({ places: [...base.places, { id: 'p9', name: 'אילת' }], shifts: d.shifts }))).toMatchObject({ kind: 'say', text: 'לא מצאתי עבודה באילת. אפשר לומר שוב עם המקום והיום של העבודה.' })
  })
})

describe('fixing the vehicle of a proposal made here', () => {
  const L = learn([], data())
  it('"לא, רכב 812" makes the same job again with that vehicle', () => {
    const first = proposal(run("תפתח עבודת יום מחר בערד 17 עם רכב 345 דאצ'יה"))!
    const p = proposal(carFix('לא, רכב 812', first, data(), L, NOW))
    expect(p?.jobs[0]).toMatchObject({ vehicleId: 'v3', location: 'ערד 17', date: '2026-11-08' })
    expect(p?.summary).toBe('עבודה חדשה: יום מחר, בערד 17. רכב 812, Dacia Dokker. לאשר, או שיש עוד תיקון?')
  })
  it('"תוסיף לעבודה את רכב 678" adds it to the job being opened', () => {
    const first = proposal(run('תפתח עבודת יום מחר בערד 17'))!
    expect(proposal(carFix('תוסיף לעבודה את רכב 678', first, data(), L, NOW))?.jobs[0].vehicleId).toBe('v2')
  })
  it('no such vehicle: said, the proposal stays', () => {
    const first = proposal(run('תפתח עבודת יום מחר בערד 17 עם רכב 678'))!
    const p = proposal(carFix('רכב 999', first, data(), L, NOW))
    expect(p?.jobs[0].vehicleId).toBe('v2')
    expect(p?.summary).toMatch(/^לא מצאתי רכב שמספר הרישוי שלו נגמר ב-999/)
  })
  it('anything more than a vehicle goes to Claude', () => {
    const first = proposal(run('תפתח עבודת יום מחר בערד 17'))!
    expect(carFix('רכב 678 ותזיז את זה לשלישי', first, data(), L, NOW)).toBeNull()
    expect(carFix('תוסיף את דני', first, data(), L, NOW)).toBeNull()
    expect(carFix('רכב 678 ביום שלישי', first, data(), L, NOW)).toBeNull()
  })
})

describe('must still go to Claude', () => {
  const d = data({ shifts: [shift('a', '2026-11-08', 'ערד 17'), shift('c', '2026-11-08', 'ערד 17', { shiftDefinitionId: 's2' })] })
  it.each([
    'תוסיף לעבודה את רכב 678', // which job: the conversation knows
    'תוסיף לעבודה בערד 17 את רכב 678', // two jobs there tomorrow
    'מה עם רכב 678?',
    'מי נוסע ברכב 678 מחר',
    'דני חולה מחר ורכב 345 במוסך',
    'תפתח עבודת יום מחר בערד 17 צריך רכב',
    'תוסיף לעבודה בערד את רכב 678 ואת דני',
  ])('%s', (s) => {
    expect(run(s, d)).toBeNull()
  })
})

describe('the read-back of any proposal says the vehicle (Claude too)', () => {
  const claude = (over: Record<string, unknown>) => normalizeProposal({ summary: 'עבודה חדשה מחר בערד. לאשר, או שיש עוד תיקון?', jobs: [{ date: '2026-11-08', shiftKindId: 's1', location: 'ערד 17', jobDescription: 'תחזוקה', staffing: [{ count: 1, certificationIds: [] }], vehicleId: 'v2' }], ...over })
  it('adds the digits, make and model when the summary leaves them out', () => {
    const p = claude({})
    const lines = proposalVehicles(p, data())
    expect(lines).toEqual(['רכב לעבודה בערד 17: 678, סיטרואן ברלינגו.'])
    expect(summaryWith(p.summary, lines)).toBe('עבודה חדשה מחר בערד. רכב לעבודה בערד 17: 678, סיטרואן ברלינגו. לאשר, או שיש עוד תיקון?')
  })
  it('says nothing more when the summary already says it, in Hebrew or English', () => {
    expect(proposalVehicles(claude({ summary: 'עבודה מחר בערד עם רכב 678 סיטרואן ברלינגו. לאשר, או שיש עוד תיקון?' }), data())).toEqual([])
    const isuzu = claude({ summary: 'רכב 345, איסוזו דימקס. לאשר, או שיש עוד תיקון?', jobs: [{ date: '2026-11-08', shiftKindId: 's1', location: 'ערד 17', jobDescription: 'x', staffing: [], vehicleId: 'v1' }] })
    expect(saysCar(isuzu.summary, VEHICLES[0])).toBe(true)
    expect(proposalVehicles(isuzu, data())).toEqual([])
  })
  it('corrects a make the manager said wrong, when the model did not', () => {
    const p = claude({ summary: 'רכב 345, Isuzu D-Max 4X4 לעבודה בערד. לאשר, או שיש עוד תיקון?', jobs: [{ date: '2026-11-08', shiftKindId: 's1', location: 'ערד 17', jobDescription: 'x', staffing: [], vehicleId: 'v1' }] })
    expect(proposalVehicles(p, data(), "תוסיף עבודה מחר בערד עם רכב 345 דאצ'יה")).toEqual(["שים לב, רכב 345 הוא Isuzu D-Max 4X4, לא דאצ'יה. רכב דאצ'יה אצלנו הוא 812."])
    expect(proposalVehicles({ ...p, summary: `רכב 345 הוא איסוזו, לא דאצ'יה. ${p.summary}` }, data(), "רכב 345 דאצ'יה")).toEqual([])
  })
  it('an edit with a vehicle id that does not exist is refused', () => {
    const p = normalizeProposal({ summary: 'x', editJobs: [{ id: 'a', vehicleId: 'nope' }] })
    expect(proposalErrors(p, data({ shifts: [shift('a', '2026-11-08', 'ערד 17')] }))).toContain('עריכה 1: אין רכב עם id "nope"')
  })
  it('"none" takes the vehicle off a job', () => {
    const d = data({ shifts: [shift('a', '2026-11-08', 'ערד 17', { vehicleId: 'v2', vehicleModel: 'ברלינגו' })] })
    const out = applyProposal(normalizeProposal({ summary: 'x', editJobs: [{ id: 'a', vehicleId: 'none' }] }), d, NOW)
    expect(out.data.shifts[0].vehicleId).toBeUndefined()
    expect(out.report).toEqual(['הורדתי את הרכב מהעבודה בערד 17'])
  })
  it('Claude sees each vehicle with its last 3 digits, and the vehicle of each job', () => {
    const s = snapshot(data({ shifts: [shift('a', '2026-11-08', 'ערד 17', { vehicleId: 'v2' })] }), NOW)
    expect(s.vehicles[1]).toEqual({ id: 'v2', last3: '678', plate: '123-45-678', make: 'סיטרואן', model: 'ברלינגו' })
    expect(s.shifts[0].vehicle).toBe('678, סיטרואן ברלינגו')
  })
})
