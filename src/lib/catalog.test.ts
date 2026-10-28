import { describe, expect, it } from 'vitest'
import {
  endsNextDay,
  filterWorkers,
  generalRoleId,
  resizeStaffing,
  staffingFor,
  withGeneralRole,
  fullName,
  nameError,
  normalizeShift,
  normalizeWorker,
  removeTagReferences,
  shiftError,
  STARTER_SHIFTS,
  tagNames,
  tagUsage,
  telHref,
  isIsraeliMobile,
  upsert,
} from './catalog'
import type { Role, ShiftDefinition, Worker } from '../types/models'

const roles: Role[] = [
  { id: 'r1', name: 'טפסן' },
  { id: 'r2', name: 'חשמלאי' },
]
const worker = (id: string, roleIds: string[], certificationIds: string[] = []): Worker => ({
  id,
  firstName: id,
  lastName: '',
  roleIds,
  certificationIds,
  constraints: [],
})
const workers: Worker[] = [worker('w1', ['r1', 'r2'], ['c1']), worker('w2', ['r2'], ['c1', 'c2'])]
const shifts: ShiftDefinition[] = [
  { id: 's1', name: 'יום', startTime: '07:00', endTime: '16:00', requiredHeadcount: 1, requiredRoleIds: ['r1'], requiredCertificationIds: [] },
]

describe('nameError', () => {
  it('rejects empty and whitespace-only names', () => {
    expect(nameError('', roles)).toBeTruthy()
    expect(nameError('   ', roles)).toBeTruthy()
  })
  it('rejects a duplicate, ignoring case and surrounding spaces', () => {
    expect(nameError(' טפסן ', roles)).toBe('השם הזה כבר קיים')
    expect(nameError('Abc', [{ id: 'x', name: 'abc' }])).toBe('השם הזה כבר קיים')
  })
  it('allows keeping the same name when editing that item', () => {
    expect(nameError('טפסן', roles, 'r1')).toBeNull()
  })
})

describe('shiftError', () => {
  const base = { name: 'ערב', startTime: '15:00', endTime: '23:00', requiredHeadcount: 1, requiredRoleIds: [], requiredCertificationIds: [] }
  it('accepts a valid shift and every starter shift', () => {
    expect(shiftError(base, shifts)).toBeNull()
    for (const s of STARTER_SHIFTS) expect(shiftError(s, [])).toBeNull()
  })
  it('rejects missing times and zero headcount', () => {
    expect(shiftError({ ...base, endTime: '' }, shifts)).toBeTruthy()
    expect(shiftError({ ...base, startTime: '25:00' }, shifts)).toBeTruthy()
    expect(shiftError({ ...base, requiredHeadcount: 0 }, shifts)).toBeTruthy()
  })
  it('rejects a duplicate shift name', () => {
    expect(shiftError({ ...base, name: 'יום' }, shifts)).toBeTruthy()
  })
})

describe('endsNextDay', () => {
  it('uses the explicit flag when set', () => {
    expect(endsNextDay({ startTime: '07:00', endTime: '16:00', endsNextDay: true })).toBe(true)
    expect(endsNextDay({ startTime: '07:00', endTime: '16:00' })).toBe(false)
  })
  it('falls back to the times for older files', () => {
    expect(endsNextDay({ startTime: '20:00', endTime: '14:00' })).toBe(true)
    expect(endsNextDay({ startTime: '07:00', endTime: '07:00' })).toBe(true)
  })
  it('the starter night shift ends the next day at 16:00, the day shift the same day', () => {
    const night = STARTER_SHIFTS.find((s) => s.name === 'לילה')!
    expect(endsNextDay(night)).toBe(true)
    expect(night.endTime).toBe('16:00')
    expect(endsNextDay(STARTER_SHIFTS.find((s) => s.name === 'יום')!)).toBe(false)
  })
})

describe('upsert', () => {
  it('replaces in place or appends', () => {
    expect(upsert(roles, { id: 'r1', name: 'x' }).map((r) => r.name)).toEqual(['x', 'חשמלאי'])
    expect(upsert(roles, { id: 'r3', name: 'y' })).toHaveLength(3)
  })
})

describe('tags (roles and certifications)', () => {
  it('counts usage per kind', () => {
    expect(tagUsage('roles', 'r1', workers, shifts)).toEqual({ workers: 1, shifts: 1 })
    expect(tagUsage('certifications', 'c1', workers, shifts)).toEqual({ workers: 2, shifts: 0 })
  })
  it('removes every reference of the deleted tag only', () => {
    const next = removeTagReferences('roles', 'r1', workers, shifts)
    expect(next.workers[0].roleIds).toEqual(['r2'])
    expect(next.workers[0].certificationIds).toEqual(['c1'])
    expect(next.shifts[0].requiredRoleIds).toEqual([])
  })
  it('returns untouched lists as the same array so they are not re-saved', () => {
    const next = removeTagReferences('certifications', 'c2', workers, shifts)
    expect(next.shifts).toBe(shifts)
    expect(next.workers).not.toBe(workers)
  })
  it('ignores ids of deleted tags when showing names', () => {
    expect(tagNames(['r2', 'gone'], roles)).toEqual(['חשמלאי'])
  })
})

describe('filterWorkers', () => {
  it('returns everyone when nothing is selected', () => {
    expect(filterWorkers(workers, [], [])).toHaveLength(2)
  })
  it('needs every selected role and certification', () => {
    expect(filterWorkers(workers, ['r2'], []).map((w) => w.id)).toEqual(['w1', 'w2'])
    expect(filterWorkers(workers, ['r2'], ['c2']).map((w) => w.id)).toEqual(['w2'])
    expect(filterWorkers(workers, ['r1'], ['c2'])).toEqual([])
    expect(filterWorkers(workers, [], ['c1']).map((w) => w.id)).toEqual(['w1', 'w2'])
  })
})

describe('normalize older files', () => {
  it('splits a single name and keeps the phone as mobile', () => {
    const w = normalizeWorker({ id: 'w', name: 'דנה בת כהן', phone: '050', roleIds: ['r1'], constraints: [] } as never)
    expect(w).toMatchObject({ firstName: 'דנה', lastName: 'בת כהן', mobilePhone: '050', roleIds: ['r1'], certificationIds: [] })
    expect('name' in w).toBe(false)
    expect(fullName(w)).toBe('דנה בת כהן')
  })
  it('leaves a current worker unchanged', () => {
    expect(normalizeWorker(workers[1])).toEqual(workers[1])
  })
  it('adds missing certification requirements to a shift', () => {
    const { requiredCertificationIds: _, ...old } = shifts[0]
    expect(normalizeShift(old).requiredCertificationIds).toEqual([])
    expect(normalizeShift({ ...old, startTime: '20:00', endTime: '14:00' }).endsNextDay).toBe(true)
  })
})

describe('telHref', () => {
  it('keeps only digits and a leading plus', () => {
    expect(telHref('050-123 4567')).toBe('tel:0501234567')
    expect(telHref(' +972 (50) 1234567 ')).toBe('tel:+972501234567')
  })
  it('returns null when there is nothing to dial', () => {
    expect(telHref(undefined)).toBeNull()
    expect(telHref('  ')).toBeNull()
    expect(telHref('אין')).toBeNull()
  })
})

describe('isIsraeliMobile', () => {
  it('accepts 05X numbers, local or with +972, with or without separators', () => {
    expect(isIsraeliMobile('0501234567')).toBe(true)
    expect(isIsraeliMobile('050-123 4567')).toBe(true)
    expect(isIsraeliMobile('+972 (50) 1234567')).toBe(true)
    expect(isIsraeliMobile('972-54-1234567')).toBe(true)
  })
  it('rejects empty, short, landline and non-numbers', () => {
    expect(isIsraeliMobile(undefined)).toBe(false)
    expect(isIsraeliMobile('')).toBe(false)
    expect(isIsraeliMobile('050123456')).toBe(false)
    expect(isIsraeliMobile('05012345678')).toBe(false)
    expect(isIsraeliMobile('031234567')).toBe(false)
    expect(isIsraeliMobile('אין')).toBe(false)
  })
})

describe('general role', () => {
  it('is added when the roles file has none, and found by name when it has one', () => {
    const roles = [{ id: 'r1', name: 'טפסן' }]
    expect(withGeneralRole(roles)[0]).toEqual({ id: 'general', name: 'כללי' })
    const old = [{ id: 'uuid-1', name: 'כללי' }, ...roles]
    expect(withGeneralRole(old)).toBe(old)
    expect(generalRoleId(old)).toBe('uuid-1')
  })

  it('every worker holds it, so filtering by it keeps everyone', () => {
    const ws = [normalizeWorker({ id: 'a', firstName: 'א', roleIds: [] }), normalizeWorker({ id: 'b', firstName: 'ב', roleIds: ['r1'] })]
    expect(filterWorkers(ws, ['general'], [], 'general')).toHaveLength(2)
    expect(filterWorkers(ws, ['general', 'r1'], [], 'general').map((w) => w.id)).toEqual(['b'])
  })
})

describe('staffing', () => {
  const roles = [{ id: 'general', name: 'כללי' }, { id: 'r1', name: 'טפסן' }]

  it('defaults to one person in the general role, with no certification', () => {
    expect(staffingFor(undefined, roles, [])).toEqual([{ roleId: 'general', certificationId: undefined }])
    expect(staffingFor([], roles, [])).toHaveLength(1)
  })

  it('a deleted role falls back to general and a deleted certification is dropped', () => {
    expect(staffingFor([{ roleId: 'gone', certificationId: 'c-gone' }, { roleId: 'r1', certificationId: 'c1' }], roles, ['c1'])).toEqual([
      { roleId: 'general', certificationId: undefined },
      { roleId: 'r1', certificationId: 'c1' },
    ])
  })

  it('grows with general slots, shrinks from the end, and stays between 1 and 20', () => {
    const one = [{ roleId: 'r1' }]
    expect(resizeStaffing(one, 3, 'general')).toEqual([{ roleId: 'r1' }, { roleId: 'general' }, { roleId: 'general' }])
    expect(resizeStaffing(resizeStaffing(one, 3, 'general'), 1, 'general')).toEqual(one)
    expect(resizeStaffing(one, 0, 'general')).toHaveLength(1)
    expect(resizeStaffing(one, 99, 'general')).toHaveLength(20)
  })
})
