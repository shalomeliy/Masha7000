import { describe, expect, it } from 'vitest'
import { dailyReport, reportDue, reportSpeech } from './dailyReport'
import type { GapContext } from './gaps'
import type { ShiftDefinition, ShiftRecord, Worker } from '../types/models'

const day: ShiftDefinition = { id: 'day', name: 'יום', startTime: '07:00', endTime: '16:00', requiredCertificationIds: [] }
const certifications = [{ id: 'climber', name: 'טפסן' }, { id: 'first-aid', name: 'עזרה ראשונה', noExpiry: true as const }]
const today = '2026-11-28' // Saturday; tomorrow is Sunday 29.11

const worker = (id: string, over: Partial<Worker> = {}): Worker => ({
  id,
  firstName: id,
  lastName: 'כהן',
  mobilePhone: '0501234567',
  emergencyPhone1: '0507654321',
  certificationIds: [],
  constraints: [],
  ...over,
})
const shift = (id: string, date: string, over: Partial<ShiftRecord> = {}): ShiftRecord => ({
  id,
  date,
  shiftDefinitionId: 'day',
  location: 'ערד',
  jobDescription: 'התקנה',
  crew: [],
  staffing: [{}],
  ...over,
})
const ctx = (workers: Worker[], records: ShiftRecord[]): GapContext => ({ workers, records, defs: [day], certifications })
const texts = (c: GapContext) => dailyReport(c, today).map((i) => `${i.group}|${i.text}`)

describe('dailyReport: the next two days', () => {
  it('is empty when everything is in order', () => {
    const s = shift('s', '2026-11-29', { crew: [{ workerId: 'a' }] })
    expect(dailyReport(ctx([worker('a')], [s]), today)).toEqual([])
  })

  it('a job tomorrow with nobody, and one the day after with one place empty', () => {
    const a = shift('a', '2026-11-29', { staffing: [{}, {}] })
    const b = shift('b', '2026-11-30', { location: 'חיפה', staffing: [{}, {}], crew: [{ workerId: 'x' }] })
    expect(texts(ctx([worker('x')], [a, b]))).toEqual(['urgent|מחר בערד: אין אף עובד משובץ', 'urgent|שני 30.11 בחיפה: חסר עובד אחד'])
  })

  it('a worker who reported sick is named in tomorrow\'s job', () => {
    const s = shift('s', '2026-11-29', { crew: [{ workerId: 'a' }] })
    const sick = worker('a', { status: 'sick', sickUntil: '2026-11-30' })
    expect(texts(ctx([sick], [s]))).toEqual(['urgent|מחר בערד: a כהן במחלה עד 30.11'])
  })

  it('a worker booked in two jobs at once, and a cert that expires before the job', () => {
    const climb = { certificationIds: ['climber'] }
    const w = worker('a', { certificationIds: ['climber'], certRatings: { climber: 4 }, certExpiry: { climber: '2026-11-29' } })
    const one = shift('one', '2026-11-30', { staffing: [climb], crew: [{ workerId: 'a' }] })
    const two = shift('two', '2026-11-30', { location: 'אילת', staffing: [climb], crew: [{ workerId: 'a' }] })
    const lines = texts(ctx([w], [one, two]))
    expect(lines[0]).toContain('a כהן משובץ גם בעבודה אחרת באותו זמן')
    expect(lines[0]).toContain('ההסמכה טפסן של a כהן לא בתוקף ביום העבודה')
  })

  it('skips closed jobs, past jobs and jobs three days away', () => {
    const recs = [shift('c', '2026-11-29', { closure: { outcome: 'done' } as ShiftRecord['closure'] }), shift('p', '2026-11-27'), shift('far', '2026-12-01')]
    expect(dailyReport(ctx([], recs), today).filter((i) => i.group === 'urgent')).toEqual([])
  })
})

describe('dailyReport: missing data', () => {
  it('a worker with no mobile or emergency phone, a cert without stars or expiry', () => {
    const w = worker('a', { mobilePhone: '', emergencyPhone1: undefined, certificationIds: ['climber', 'first-aid'], certRatings: { climber: 0, 'first-aid': 0 } })
    expect(texts(ctx([w], []))).toEqual([
      'data|a כהן: אין טלפון נייד, אין טלפון חירום, אין כוכבים בהסמכה טפסן, אין תאריך תוקף להסמכה טפסן, אין כוכבים בהסמכה עזרה ראשונה',
    ])
  })

  it('leaves out inactive workers', () => {
    expect(dailyReport(ctx([worker('a', { status: 'inactive', mobilePhone: '' })], []), today)).toEqual([])
  })

  it('a future job without a place or a description', () => {
    const s = shift('s', '2026-12-10', { location: '', jobDescription: ' ', crew: [{ workerId: 'a' }] })
    expect(texts(ctx([worker('a')], [s]))).toEqual(['data|עבודה חמישי 10.12: אין מיקום, אין תיאור עבודה'])
  })

  it('opens the job or the worker from each line', () => {
    const items = dailyReport(ctx([worker('a', { mobilePhone: '' })], [shift('s', '2026-11-29')]), today)
    expect(items.map((i) => i.shiftId ?? i.workerId)).toEqual(['s', 'a'])
  })
})

describe('reportDue and reportSpeech', () => {
  it('is due from the chosen hour', () => {
    expect(reportDue(new Date(2026, 10, 28, 17, 59))).toBe(false)
    expect(reportDue(new Date(2026, 10, 28, 18, 0))).toBe(true)
    expect(reportDue(new Date(2026, 10, 28, 20, 0), '21:00')).toBe(false)
  })

  it('says the urgent lines and only counts the missing data', () => {
    const items = dailyReport(ctx([worker('a', { mobilePhone: '' })], [shift('s', '2026-11-29')]), today)
    expect(reportSpeech(items)).toBe('בעיה אחת בעבודות הקרובות. מחר בערד: אין אף עובד משובץ. ועוד פריט אחד של פרטים חסרים, במסך הדוח היומי.')
    expect(reportSpeech([])).toContain('נקי')
  })
})
