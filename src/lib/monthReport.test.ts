import { describe, expect, it } from 'vitest'
import { addMonths, defaultMonth, monthCsv, monthDates, monthLabel, monthReport, monthText } from './monthReport'
import type { ShiftDefinition, ShiftRecord, Worker } from '../types/models'

const worker = (id: string, firstName: string): Worker => ({ id, firstName, lastName: 'כהן', roleIds: [], certificationIds: [], constraints: [] })
const workers = [worker('a', 'דני'), worker('b', 'יוסי'), worker('c', 'רונית')]

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

const rowOf = (rep: ReturnType<typeof monthReport>, id: string) => rep.rows.find((r) => r.workerId === id)!

describe('months', () => {
  it('labels, moves across years, knows the last day', () => {
    expect(monthLabel('2026-10')).toBe('אוקטובר 2026')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(monthDates('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(monthDates('2026-10', '2026-10-20')).toEqual({ from: '2026-10-01', to: '2026-10-20' })
    expect(monthDates('2026-09', '2026-10-20').to).toBe('2026-09-30')
  })

  it('opens on last month until the 5th', () => {
    expect(defaultMonth('2026-11-04')).toBe('2026-10')
    expect(defaultMonth('2026-11-05')).toBe('2026-11')
    expect(defaultMonth('2027-01-01')).toBe('2026-12')
  })
})

describe('monthReport', () => {
  it('counts day and night shifts, total = day + night', () => {
    // Weekdays only (Sunday-Thursday) so the weekend column stays 0.
    const days = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-18', '2026-10-19']
    const records = [
      ...days.map((d, i) => shift(`d${i}`, d, ['a'])),
      ...['2026-10-20', '2026-10-21', '2026-10-22'].map((d, i) => shift(`n${i}`, d, ['a'], { shiftDefinitionId: 'night' })),
    ]
    const r = rowOf(monthReport('2026-10', records, workers, defs), 'a')
    expect([r.day, r.night, r.total, r.weekend]).toEqual([12, 3, 15, 0])
  })

  it('counts a night job of the 31st in its own month', () => {
    const records = [shift('1', '2026-10-31', ['a'], { shiftDefinitionId: 'night' })]
    expect(rowOf(monthReport('2026-10', records, workers, defs), 'a').night).toBe(1)
    expect(rowOf(monthReport('2026-11', records, workers, defs), 'a').total).toBe(0)
  })

  it('counts the replacement, not the worker swapped out', () => {
    const records = [shift('1', '2026-10-06', ['b'], { swaps: [{ at: '2026-10-05T10:00:00Z', outId: 'a', inId: 'b', roleId: 'general' }] })]
    const rep = monthReport('2026-10', records, workers, defs)
    expect([rowOf(rep, 'a').total, rowOf(rep, 'a').swappedOut]).toEqual([0, 1])
    expect([rowOf(rep, 'b').total, rowOf(rep, 'b').swappedOut]).toEqual([1, 0])
  })

  it('counts an urgent night shift once, in night and urgent', () => {
    const records = [shift('1', '2026-10-06', ['a'], { shiftDefinitionId: undefined, urgent: true, startTime: '09:00' })]
    const r = rowOf(monthReport('2026-10', records, workers, defs), 'a')
    expect([r.day, r.night, r.urgent, r.total]).toEqual([0, 1, 1, 1])
  })

  it('counts Friday and Saturday as weekend, and a postponed job as worked', () => {
    const records = [
      shift('1', '2026-10-09', ['a']), // Friday
      shift('2', '2026-10-10', ['a'], { closure: { outcome: 'postponed', note: '', reasonIds: [], closedAt: '' } }), // Saturday
      shift('3', '2026-10-11', ['a']), // Sunday
    ]
    const r = rowOf(monthReport('2026-10', records, workers, defs), 'a')
    expect([r.weekend, r.total]).toEqual([2, 3])
  })

  it('totals equal the sum of every column, deleted workers included', () => {
    const records = [
      shift('1', '2026-10-06', ['a', 'b']),
      shift('2', '2026-10-09', ['gone'], { shiftDefinitionId: 'night', urgent: true }),
      shift('3', '2026-10-10', ['c'], { swaps: [{ at: '', outId: 'b', inId: 'c', roleId: 'general' }] }),
    ]
    const rep = monthReport('2026-10', records, workers, defs)
    expect(rep.rows.find((r) => r.workerId === 'gone')?.name).toBe('עובד שנמחק')
    for (const k of ['day', 'night', 'urgent', 'weekend', 'total', 'swappedOut'] as const) {
      expect(rep.totals[k]).toBe(rep.rows.reduce((n, r) => n + r[k], 0))
    }
    expect(rep.totals.total).toBe(4)
  })

  it('sorts by total, lists idle workers at the bottom, skips shifts after upTo', () => {
    const records = [shift('1', '2026-10-06', ['c']), shift('2', '2026-10-07', ['c']), shift('3', '2026-10-08', ['a']), shift('4', '2026-10-30', ['b'])]
    const rep = monthReport('2026-10', records, workers, defs, '2026-10-20')
    expect(rep.rows.map((r) => r.workerId)).toEqual(['c', 'a', 'b'])
    expect(rep.shifts).toBe(3)
  })
})

describe('sharing', () => {
  const records = [shift('1', '2026-10-06', ['a']), shift('2', '2026-10-09', ['a'], { shiftDefinitionId: 'night' })]
  const rep = monthReport('2026-10', records, [...workers, worker('q', 'אבי "הגדול"')], defs)

  it('builds a CSV Excel opens with Hebrew, same numbers as the screen', () => {
    const csv = monthCsv(rep)
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).trim().split('\r\n')
    expect(lines[0]).toBe('עובד,יום,לילה,דחופות,"סופ""ש","סה""כ",הוחלף')
    expect(lines[1]).toBe('דני כהן,1,1,0,1,2,0')
    expect(lines).toContain('"אבי ""הגדול"" כהן",0,0,0,0,0,0')
    expect(lines.at(-1)).toBe('"סה""כ",1,1,0,1,2,0')
  })

  it('never lets a name run as an Excel formula', () => {
    const csv = monthCsv(monthReport('2026-10', [], [{ ...worker('x', '=1+1'), lastName: '' }], defs))
    expect(csv).toContain("'=1+1,0")
  })

  it('writes WhatsApp text with only the workers who worked', () => {
    const text = monthText(rep)
    expect(text).toContain('*דוח משמרות אוקטובר 2026*')
    expect(text).toContain('*דני כהן*: 2 משמרות · יום 1 · לילה 1 · סופ"ש 1')
    expect(text).not.toContain('יוסי')
    expect(monthText(monthReport('2026-11', records, workers, defs))).toContain('אין משמרות בחודש הזה')
  })
})
