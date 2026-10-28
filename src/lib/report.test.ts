import { describe, expect, it } from 'vitest'
import { dayReport, weekReport, whatsappHref } from './report'
import type { ReportContext } from './report'
import type { ShiftRecord } from '../types/models'

const shift = (over: Partial<ShiftRecord>): ShiftRecord => ({
  id: 's1',
  date: '2026-11-01',
  shiftDefinitionId: 'night',
  location: 'חיפה',
  jobDescription: 'התקנת אנטנה',
  crew: [],
  staffing: [],
  ...over,
})

const ctx: ReportContext = {
  shifts: [
    shift({ crew: [{ workerId: 'w1', roleId: 'climber' }, { workerId: 'w2', roleId: 'general' }] }),
    shift({ id: 's2', date: '2026-11-03', shiftDefinitionId: undefined, location: 'עכו', urgent: true, startTime: '09:30', endDate: '2026-11-04', endTime: '16:00' }),
  ],
  defs: [{ id: 'night', name: 'לילה', startTime: '07:00', endTime: '16:00', endsNextDay: true, requiredRoleIds: [], requiredCertificationIds: [] }],
  workers: [
    { id: 'w1', firstName: 'דני', lastName: 'כהן', roleIds: ['climber'], certificationIds: [], constraints: [] },
    { id: 'w2', firstName: 'רון', lastName: 'לוי', roleIds: [], certificationIds: [], constraints: [] },
  ],
  roles: [{ id: 'climber', name: 'טפסן' }, { id: 'general', name: 'כללי' }],
}

describe('dayReport', () => {
  it('lists the date, place, job, workers and their roles', () => {
    expect(dayReport('2026-11-01', ctx)).toBe(
      ['*משמרות יום ראשון 1.11.2026*', '', '*1. לילה - חיפה*', 'עבודה: התקנת אנטנה', 'עובדים:', '- דני כהן (טפסן)', '- רון לוי (כללי)'].join('\n'),
    )
  })

  it('shows an urgent shift with its end and no crew yet', () => {
    const text = dayReport('2026-11-03', ctx)
    expect(text).toContain('*1. דחופה מ-09:30 - עכו*')
    expect(text).toContain('עד יום רביעי 4.11 16:00')
    expect(text).toContain('עובדים: עוד לא שובצו')
  })

  it('says so on a day with no shifts', () => {
    expect(dayReport('2026-11-02', ctx)).toContain('אין משמרות')
  })
})

describe('weekReport', () => {
  it('covers Sunday to Saturday of the given day', () => {
    const text = weekReport('2026-11-04', ctx)
    expect(text.split('\n')[0]).toBe('*סידור משמרות לשבוע 1.11 - 7.11.2026*')
    expect(text).toContain('*יום ראשון 1.11*')
    expect(text).toContain('*יום שבת 7.11*')
    expect(text).toContain('- דני כהן (טפסן)')
    expect(text).toContain('*1. דחופה מ-09:30 - עכו*')
  })
})

it('whatsappHref encodes Hebrew and line breaks', () => {
  expect(whatsappHref('שלום\nעולם')).toBe('https://wa.me/?text=%D7%A9%D7%9C%D7%95%D7%9D%0A%D7%A2%D7%95%D7%9C%D7%9D')
})
