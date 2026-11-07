import { describe, expect, it } from 'vitest'
import { searchWorkers } from './workerSearch'
import type { Worker } from '../types/models'

const w = (over: Partial<Worker>): Worker => ({ id: 'w', firstName: '', lastName: '', roleIds: [], certificationIds: [], constraints: [], ...over })
const TODAY = '2026-11-07'
const lists = {
  roles: [{ id: 'r1', name: 'מטפס' }],
  certifications: [{ id: 'c1', name: 'עבודה בגובה' }],
  departments: [{ id: 'd1', name: 'צפון' }],
}
const dani = w({ id: 'dani', firstName: 'דני', lastName: 'לוי', mobilePhone: '050-1234567', idNumber: '012345678', roleIds: ['r1'], departmentId: 'd1' })
const rina = w({ id: 'rina', firstName: 'רינה', lastName: 'כהן', personalNumber: '7788', certificationIds: ['c1'], status: 'inactive', notes: 'רישיון משאית' })
const all = [dani, rina]
const ids = (q: string) => searchWorkers(all, q, lists, TODAY).map((x) => x.id)

describe('searchWorkers', () => {
  it('empty text: everyone', () => expect(ids('  ')).toEqual(['dani', 'rina']))
  it('by first, last or full name, in any order', () => {
    expect(ids('דנ')).toEqual(['dani'])
    expect(ids('כהן רינה')).toEqual(['rina'])
  })
  it('by phone with or without dashes', () => {
    expect(ids('0501234567')).toEqual(['dani'])
    expect(ids('050-123')).toEqual(['dani'])
    expect(ids('1234567')).toEqual(['dani'])
  })
  it('by ID and personal number', () => {
    expect(ids('012345678')).toEqual(['dani'])
    expect(ids('7788')).toEqual(['rina'])
  })
  it('by department, role, certification, state and notes', () => {
    expect(ids('צפון')).toEqual(['dani'])
    expect(ids('מטפס')).toEqual(['dani'])
    expect(ids('גובה')).toEqual(['rina'])
    expect(ids('לא פעיל')).toEqual(['rina'])
    expect(ids('משאית')).toEqual(['rina'])
  })
  it('every word must match', () => expect(ids('דני גובה')).toEqual([]))
  it('nothing found', () => expect(ids('אבגד')).toEqual([]))
})
