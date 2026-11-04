import { describe, expect, it } from 'vitest'
import { formLists, joinCodeOf, matchWorker, workerFromSubmission, type JoinDetails } from './join'
import type { Worker } from '../types/models'

const worker = (over: Partial<Worker>): Worker => ({ id: 'w1', firstName: 'דנה', lastName: 'לוי', roleIds: [], certificationIds: [], constraints: [], ...over })
const sub = (over: Partial<JoinDetails> = {}): JoinDetails => ({ firstName: 'דני', lastName: 'כהן', mobilePhone: '052-7654321', roleIds: [], certificationIds: [], ...over })

describe('join form link', () => {
  it('reads the code only from a /join/<code> address', () => {
    expect(joinCodeOf('/join/AbC_123-xyz456')).toBe('AbC_123-xyz456')
    expect(joinCodeOf('/join/AbC_123-xyz456/')).toBe('AbC_123-xyz456')
    expect(joinCodeOf('/')).toBeNull()
    expect(joinCodeOf('/join/')).toBeNull()
    expect(joinCodeOf('/join/a/b')).toBeNull()
  })
})

describe('matching an answer to a worker', () => {
  const list = [worker({ id: 'a', idNumber: '012345678', mobilePhone: '050-1111111' }), worker({ id: 'b', mobilePhone: '0527654321' })]
  it('finds the same ID number first, then the same mobile in any format', () => {
    expect(matchWorker(sub({ idNumber: '012345678', mobilePhone: '0527654321' }), list)?.id).toBe('a')
    expect(matchWorker(sub({ mobilePhone: '+972-52-765-4321' }), list)?.id).toBe('b')
    expect(matchWorker(sub({ mobilePhone: '053-0000000' }), list)).toBeUndefined()
  })
})

describe('worker from an answer', () => {
  it('builds a new active worker', () => {
    const w = workerFromSubmission(sub({ roleIds: ['r1'], idNumber: '012345678' }), undefined, () => 'new')
    expect(w).toMatchObject({ id: 'new', firstName: 'דני', mobilePhone: '052-7654321', roleIds: ['r1'], status: 'active', constraints: [] })
  })
  it('writes the answer over an existing worker, keeps what it leaves empty, adds roles and notes', () => {
    const existing = worker({ address: 'חיפה', homePhone: '04-1234567', roleIds: ['r1'], notes: 'ותיק', constraints: [{ id: 'c' } as never] })
    const w = workerFromSubmission(sub({ address: 'עכו', roleIds: ['r2', 'r1'], notes: 'גר רחוק' }), existing, () => 'x')
    expect(w).toMatchObject({ id: 'w1', firstName: 'דני', address: 'עכו', homePhone: '04-1234567', roleIds: ['r1', 'r2'], notes: 'ותיק\nגר רחוק' })
    expect(w.constraints).toHaveLength(1)
  })
})

describe('form lists', () => {
  it('leaves out כללי, which every worker is', () => {
    expect(formLists([{ id: 'general', name: 'כללי' }, { id: 'r', name: 'חשמלאי' }], [], []).roles).toEqual([{ id: 'r', name: 'חשמלאי' }])
  })
})
