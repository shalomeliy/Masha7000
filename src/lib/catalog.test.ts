import { describe, expect, it } from 'vitest'
import {
  defaultShiftDef,
  endsNextDay,
  NIGHT_PLUS,
  NIGHT_PLUS_ID,
  withNightPlus,
  filterWorkers,
  certStars,
  withoutGeneralCert,
  slotCerts,
  placeText,
  resizeStaffing,
  staffingFor,
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
  isIsraeliId,
  isIsraeliMobile,
  upsert,
} from './catalog'
import type { ShiftDefinition, Worker } from '../types/models'

const certs = [
  { id: 'c1', name: 'טיפוס' },
  { id: 'c2', name: 'רתך' },
]
const worker = (id: string, certificationIds: string[]): Worker => ({ id, firstName: id, lastName: '', certificationIds, constraints: [] })
const workers: Worker[] = [worker('w1', ['c1']), worker('w2', ['c1', 'c2'])]
const shifts: ShiftDefinition[] = [
  { id: 's1', name: 'יום', startTime: '07:00', endTime: '16:00', requiredHeadcount: 1, requiredCertificationIds: ['c1'] },
]

describe('nameError', () => {
  it('rejects empty and whitespace-only names', () => {
    expect(nameError('', certs)).toBeTruthy()
    expect(nameError('   ', certs)).toBeTruthy()
  })
  it('rejects a duplicate, ignoring case and surrounding spaces', () => {
    expect(nameError(' טיפוס ', certs)).toBe('השם הזה כבר קיים')
    expect(nameError('Abc', [{ id: 'x', name: 'abc' }])).toBe('השם הזה כבר קיים')
  })
  it('allows keeping the same name when editing that item', () => {
    expect(nameError('טיפוס', certs, 'c1')).toBeNull()
  })
})

describe('shiftError', () => {
  const base = { name: 'ערב', startTime: '15:00', endTime: '23:00', requiredHeadcount: 1, requiredCertificationIds: [] }
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
    expect(upsert(certs, { id: 'c1', name: 'x' }).map((r) => r.name)).toEqual(['x', 'רתך'])
    expect(upsert(certs, { id: 'c3', name: 'y' })).toHaveLength(3)
  })
})

describe('certifications list', () => {
  it('counts usage', () => {
    expect(tagUsage('c1', workers, shifts)).toEqual({ workers: 2, shifts: 1 })
    expect(tagUsage('c2', workers, shifts)).toEqual({ workers: 1, shifts: 0 })
  })
  it('removes every reference of the deleted certification only, its stars too', () => {
    const rated = [{ ...workers[1], certRatings: { c1: 2, c2: 4 } }]
    const next = removeTagReferences('c1', rated, shifts)
    expect(next.workers[0].certificationIds).toEqual(['c2'])
    expect(next.workers[0].certRatings).toEqual({ c2: 4 })
    expect(next.shifts[0].requiredCertificationIds).toEqual([])
  })
  it('returns untouched lists as the same array so they are not re-saved', () => {
    const next = removeTagReferences('c2', workers, shifts)
    expect(next.shifts).toBe(shifts)
    expect(next.workers[0]).toBe(workers[0])
  })
  it('ignores ids of deleted certifications when showing names', () => {
    expect(tagNames(['c2', 'gone'], certs)).toEqual(['רתך'])
  })
})

describe('filterWorkers', () => {
  it('returns everyone when nothing is selected', () => {
    expect(filterWorkers(workers, [])).toHaveLength(2)
  })
  it('needs every selected certification', () => {
    expect(filterWorkers(workers, ['c1']).map((w) => w.id)).toEqual(['w1', 'w2'])
    expect(filterWorkers(workers, ['c1', 'c2']).map((w) => w.id)).toEqual(['w2'])
    expect(filterWorkers(workers, ['gone'])).toEqual([])
  })
})

describe('stars (the user, 2026-11-08)', () => {
  it('a certification with no rating saved has the full 5; 0 is "not rated yet"; a bad value counts as 5', () => {
    expect(certStars(workers[0], 'c1')).toBe(5)
    expect(certStars({ certRatings: { c1: 2 } }, 'c1')).toBe(2)
    expect(certStars({ certRatings: { c1: 0 } }, 'c1')).toBe(0)
    expect(certStars({ certRatings: { c1: 9 } }, 'c1')).toBe(5)
  })
  it('the old "כללי" is dropped from the list, from every worker and from every place (the user, 2026-11-11)', () => {
    const withOld = [{ id: 'general', name: 'כללי' }, ...certs]
    expect(withoutGeneralCert(withOld)).toEqual(certs)
    expect(withoutGeneralCert(certs)).toBe(certs)
    const w = normalizeWorker({ ...workers[0], certificationIds: ['general', 'c1'], certRatings: { general: 5, c1: 2 }, certExpiry: { general: '2027-01-01' } })
    expect(w.certificationIds).toEqual(['c1'])
    expect(w.certRatings).toEqual({ c1: 2 })
    expect(w.certExpiry).toEqual({})
    expect(slotCerts({ certificationIds: ['general'] })).toEqual([])
    expect(placeText({ certificationIds: ['general'] }, certs)).toBe('ללא')
  })
})

describe('normalize older files', () => {
  it('splits a single name and keeps the phone as mobile', () => {
    const w = normalizeWorker({ id: 'w', name: 'דנה בת כהן', phone: '050', constraints: [] } as never)
    expect(w).toMatchObject({ firstName: 'דנה', lastName: 'בת כהן', mobilePhone: '050', certificationIds: [] })
    expect('name' in w).toBe(false)
    expect(fullName(w)).toBe('דנה בת כהן')
  })
  it('leaves a current worker unchanged', () => {
    const w: Worker = { ...workers[1], certificationIds: ['c1'], mobilePhone: '050', status: 'sick', sickUntil: '2026-11-05' }
    expect(normalizeWorker(w)).toEqual(w)
  })
  it('a worker saved while roles existed keeps only the certifications', () => {
    const w = normalizeWorker({ ...workers[1], roleIds: ['r1'] } as never)
    expect('roleIds' in w).toBe(false)
    expect(w.certificationIds).toEqual(['c1', 'c2'])
    const def = normalizeShift({ ...shifts[0], requiredRoleIds: ['r1'] } as never)
    expect('requiredRoleIds' in def).toBe(false)
  })
  it('a worker saved before statuses is active', () => {
    expect(normalizeWorker(workers[1]).status).toBe('active')
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

describe('staffing', () => {
  it('defaults to one person who needs no certification', () => {
    expect(staffingFor(undefined, [])).toEqual([{}])
    expect(staffingFor([], [])).toHaveLength(1)
  })

  it('drops a deleted certification and what older files held for certs', () => {
    const old = { roleId: 'r1', alsoRoleIds: ['r2'], altRoleIds: ['r3'], certificationIds: ['gone', 'c1'], kindId: 'k' }
    expect(staffingFor([{ certificationIds: ['gone'] }, old as never], ['c1'])).toEqual([{}, { certificationIds: ['c1'], kindId: 'k' }])
  })

  it('reads the single certification older files kept', () => {
    expect(staffingFor([{ certificationId: 'c1' }], ['c1'])).toEqual([{ certificationIds: ['c1'] }])
  })

  it('grows with places that need nothing, shrinks from the end, and stays between 1 and 20', () => {
    const one = [{ certificationIds: ['c1'] }]
    expect(resizeStaffing(one, 3)).toEqual([{ certificationIds: ['c1'] }, {}, {}])
    expect(resizeStaffing(resizeStaffing(one, 3), 1)).toEqual(one)
    expect(resizeStaffing(one, 0)).toHaveLength(1)
    expect(resizeStaffing(one, 99)).toHaveLength(20)
  })
})

describe('לינה', () => {
  const day = { id: 'd', name: 'יום', startTime: '07:00', endTime: '16:00', requiredCertificationIds: [] }
  const night = { ...day, id: 'n', name: 'לילה', endsNextDay: true }

  it('is added last to a list saved before it existed, and counts as a night', () => {
    const defs = withNightPlus([day, night])
    expect(defs.map((d) => d.id)).toEqual(['d', 'n', NIGHT_PLUS_ID])
    expect(endsNextDay(defs[2])).toBe(true)
  })

  it('leaves an empty list empty and a list that has it as it is', () => {
    expect(withNightPlus([])).toEqual([])
    const list = [day, NIGHT_PLUS]
    expect(withNightPlus(list)).toBe(list)
  })

  it('marks a type the manager already named "לינה" instead of adding a second one', () => {
    const own = { ...day, id: 'mine', name: ' לינה ' }
    const defs = withNightPlus([day, own])
    expect(defs).toHaveLength(2)
    expect(defs[1]).toMatchObject({ id: 'mine', thenJob: true, endsNextDay: true })
  })

  it('renames a type saved under the old name "לילה+" to "לינה"', () => {
    expect(withNightPlus([day, { ...NIGHT_PLUS, name: 'לילה+' }])[1]).toMatchObject({ id: NIGHT_PLUS_ID, name: 'לינה', thenJob: true })
    const own = withNightPlus([day, { ...day, id: 'mine', name: 'לילה+' }])
    expect(own).toHaveLength(2)
    expect(own[1]).toMatchObject({ id: 'mine', name: 'לינה', thenJob: true })
  })

  it('a new shift starts as "יום"', () => {
    expect(defaultShiftDef([night, NIGHT_PLUS, day])?.id).toBe('d')
    expect(defaultShiftDef([night, { ...day, name: 'בוקר' }])?.name).toBe('בוקר')
  })
})

describe('isIsraeliId', () => {
  it('accepts exactly 9 digits, ignoring spaces and dashes', () => {
    expect(isIsraeliId('012345678')).toBe(true)
    expect(isIsraeliId('01234567-8')).toBe(true)
    expect(isIsraeliId('12345678')).toBe(false)
    expect(isIsraeliId('1234567890')).toBe(false)
    expect(isIsraeliId('01234567a')).toBe(false)
    expect(isIsraeliId(undefined)).toBe(false)
  })
})
