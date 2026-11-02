import { describe, expect, it } from 'vitest'
import { csvFileName } from './monthReport'
import { addDays, defaultWeek, weekDates, weekLabel, weekOf, weekReport, weekText } from './weekReport'
import type { ShiftDefinition, ShiftRecord, Worker } from '../types/models'

const worker = (id: string, firstName: string): Worker => ({ id, firstName, lastName: 'כהן', roleIds: [], certificationIds: [], constraints: [] })
const workers = [worker('a', 'דני'), worker('b', 'יוסי')]

const defs: ShiftDefinition[] = [
  { id: 'day', name: 'יום', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00' },
  { id: 'night', name: 'לילה', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00', endsNextDay: true },
]

const shift = (id: string, date: string, crew: string[], extra: Partial<ShiftRecord> = {}): ShiftRecord => ({
  id,
  date,
  shiftDefinitionId: 'day',
  location: 'חיפה',
  jobDescription: '',
  crew: crew.map((workerId) => ({ workerId, roleId: 'general' })),
  staffing: [],
  ...extra,
})

describe('weeks', () => {
  it('starts on Sunday and ends on Saturday, across months and years', () => {
    expect(weekOf('2026-10-31')).toBe('2026-10-25') // Saturday
    expect(weekOf('2026-11-01')).toBe('2026-11-01') // Sunday
    expect(weekOf('2027-01-01')).toBe('2026-12-27')
    expect(addDays('2026-12-27', 7)).toBe('2027-01-03')
    expect(weekDates('2026-10-25')).toEqual({ from: '2026-10-25', to: '2026-10-31' })
    expect(weekDates('2026-11-01', '2026-11-03')).toEqual({ from: '2026-11-01', to: '2026-11-03' })
    expect(weekLabel('2026-10-25')).toBe('25.10–31.10.2026')
    expect(weekLabel('2026-12-27')).toBe('27.12–2.1.2027')
  })

  it('opens on last week on Sunday, else on this week', () => {
    expect(defaultWeek('2026-11-01')).toBe('2026-10-25') // Sunday
    expect(defaultWeek('2026-11-02')).toBe('2026-11-01')
    expect(defaultWeek('2026-11-07')).toBe('2026-11-01') // Saturday
  })
})

describe('weekReport', () => {
  const records = [
    shift('1', '2026-10-24', ['a']), // Saturday of the week before
    shift('2', '2026-10-25', ['a']), // Sunday
    shift('3', '2026-10-30', ['a', 'b'], { shiftDefinitionId: 'night' }), // Friday
    shift('4', '2026-10-31', ['b'], { urgent: true, swaps: [{ at: '', outId: 'a', inId: 'b', roleId: 'general' }] }), // Saturday
    shift('5', '2026-11-01', ['a']), // next Sunday
  ]

  it('counts only Sunday to Saturday, with the monthly rules', () => {
    const rep = weekReport('2026-10-25', records, workers, defs)
    expect(rep.shifts).toBe(3)
    const a = rep.rows.find((r) => r.workerId === 'a')!
    const b = rep.rows.find((r) => r.workerId === 'b')!
    expect([a.day, a.night, a.weekend, a.total, a.swappedOut]).toEqual([1, 1, 1, 2, 1])
    expect([b.day, b.night, b.urgent, b.weekend, b.total]).toEqual([0, 2, 1, 2, 2])
    expect(rep.totals.total).toBe(4)
  })

  it('leaves out days after upTo', () => {
    expect(weekReport('2026-10-25', records, workers, defs, '2026-10-29').shifts).toBe(1)
  })

  it('writes WhatsApp text and a CSV name for the week', () => {
    expect(weekText(weekReport('2026-10-25', records, workers, defs))).toContain('*דוח עבודות שבועי 25.10–31.10.2026*')
    expect(weekText(weekReport('2026-10-11', records, workers, defs))).toContain('אין עבודות בשבוע הזה')
    expect(csvFileName('2026-10-25')).toBe('masha7000-week-2026-10-25.csv')
    expect(csvFileName('2026-10')).toBe('masha7000-2026-10.csv')
  })
})
