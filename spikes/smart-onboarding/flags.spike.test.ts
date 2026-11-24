// Spike (throwaway, never ships): can features be turned off at a few choke points, without touching
// every screen? Assumptions tested:
// A1. A small catalog with dependencies resolves to a consistent on/off set (certExpiry needs certs).
// A2. "certs off" can be done at ONE point: staffing read through staffingFor(staffing, []) makes "שבץ"
//     ignore certifications, with no change to the solver.
// A3. Existing managers (no onboarding record) see everything on.
import { describe, expect, it } from 'vitest'
import { staffingFor } from '../../src/lib/catalog'
import { autoAssign } from '../../src/lib/planner'
import type { ShiftRecord, Worker } from '../../src/types/models'

type FeatureId = 'certs' | 'certExpiry' | 'vehicles' | 'constraints' | 'constraintForm' | 'shali'
const NEEDS: Partial<Record<FeatureId, FeatureId>> = { certExpiry: 'certs', constraintForm: 'constraints' }
const ALL: FeatureId[] = ['certs', 'certExpiry', 'vehicles', 'constraints', 'constraintForm', 'shali']

function resolve(saved: Partial<Record<FeatureId, boolean>> | undefined, onboarded: boolean) {
  const on = (id: FeatureId): boolean => {
    const own = onboarded ? saved?.[id] === true : true // A3: not onboarded = everything on
    const need = NEEDS[id]
    return own && (need ? on(need) : true)
  }
  return Object.fromEntries(ALL.map((id) => [id, on(id)])) as Record<FeatureId, boolean>
}

const worker = (id: string, certs: string[]): Worker => ({ id, firstName: id, lastName: 'x', certificationIds: certs, constraints: [] })
const shift: ShiftRecord = { id: 's1', date: '2026-12-01', location: 'a', jobDescription: 'b', crew: [], staffing: [{ certificationIds: ['climb'] }] }
const ctx = { workers: [worker('noCert', [])], records: [], defs: [] }

describe('feature flags spike', () => {
  it('A1: a dependency turns off with its parent', () => {
    const f = resolve({ certs: false, certExpiry: true, vehicles: true }, true)
    console.log('A1', f)
    expect(f.certExpiry).toBe(false)
    expect(f.vehicles).toBe(true)
  })
  it('A2: certs on -> the place stays empty; certs off -> the worker without the cert is picked', () => {
    const on = autoAssign(shift, staffingFor(shift.staffing, ['climb']), ctx)
    const off = autoAssign(shift, staffingFor(shift.staffing, []), ctx)
    console.log('A2 on:', on.crew, on.unfilled.length, '| off:', off.crew, off.unfilled.length)
    expect(on.crew).toHaveLength(0)
    expect(off.crew.map((c) => c.workerId)).toEqual(['noCert'])
  })
  it('A3: a manager without onboarding sees everything', () => {
    expect(Object.values(resolve(undefined, false)).every(Boolean)).toBe(true)
  })
})
