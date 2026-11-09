import { describe, expect, it } from 'vitest'
import { expiryCounts, expiryNote, expiryState, keepHeldExpiry, setCertExpiry, validOn } from './certExpiry'
import { autoAssign } from './planner'
import type { ShiftDefinition, ShiftRecord, Worker } from '../types/models'

const worker = (id: string, certExpiry?: Record<string, string>): Worker => ({
  id,
  firstName: id,
  lastName: '',
  certificationIds: ['general', 'climber', 'elec'],
  constraints: [],
  ...(certExpiry ? { certExpiry } : {}),
})
const today = '2026-11-09'

describe('certification expiry', () => {
  it('is fine far ahead, orange within 30 days, red after the last day', () => {
    const w = worker('a', { climber: '2026-12-09', elec: '2026-12-10' })
    expect(expiryState(w, 'climber', today)).toBe('soon')
    expect(expiryState(w, 'elec', today)).toBeNull()
    expect(expiryState(w, 'general', today)).toBeNull()
    // Valid through its last day.
    expect(expiryState(worker('b', { climber: today }), 'climber', today)).toBe('soon')
    expect(expiryState(worker('b', { climber: '2026-11-08' }), 'climber', today)).toBe('expired')
  })

  it('says the date in the note', () => {
    expect(expiryNote(worker('a', { climber: '2026-11-20' }), 'climber', today)).toBe('התוקף נגמר ב-20.11.2026')
    expect(expiryNote(worker('a', { climber: '2026-11-01' }), 'climber', today)).toBe('פג תוקף ב-1.11.2026')
    expect(expiryNote(worker('a'), 'climber', today)).toBeNull()
  })

  it('counts soon and expired among the certifications the worker holds', () => {
    const w = worker('a', { climber: '2026-11-01', elec: '2026-11-15', gone: '2026-01-01' })
    expect(expiryCounts(w, ['general', 'climber', 'elec', 'gone'], today)).toEqual({ soon: 1, expired: 1 })
  })

  it('sets, clears and drops dates of certifications no longer held', () => {
    const w = setCertExpiry(worker('a'), 'climber', '2027-01-01')
    expect(w.certExpiry).toEqual({ climber: '2027-01-01' })
    expect(setCertExpiry(w, 'climber', '').certExpiry).toBeUndefined()
    expect(keepHeldExpiry({ ...w, certificationIds: ['general'] }).certExpiry).toBeUndefined()
  })

  it('"שבץ" does not count a certification expired by the day of the job', () => {
    expect(validOn(worker('a', { climber: '2026-11-10' }), '2026-11-11').certificationIds).toEqual(['general', 'elec'])
    expect(validOn(worker('a', { climber: '2026-11-10' }), '2026-11-10').certificationIds).toContain('climber')
    const day: ShiftDefinition = { id: 'day', name: 'יום', startTime: '07:00', endTime: '16:00', requiredCertificationIds: [] }
    const shift: ShiftRecord = { id: 's', date: '2026-11-11', shiftDefinitionId: 'day', location: '', jobDescription: '', crew: [], staffing: [] }
    const lapsed = worker('a', { climber: '2026-11-01' })
    const ok = { ...worker('b'), firstName: 'z' }
    const ctx = { workers: [lapsed, ok], records: [], defs: [day] }
    expect(autoAssign(shift, [{ certificationIds: ['climber'] }], ctx).crew).toEqual([{ workerId: 'b' }])
    const alone = autoAssign(shift, [{ certificationIds: ['climber'] }], { ...ctx, workers: [lapsed] })
    expect(alone.crew).toEqual([])
    expect(alone.why[0]).toContain('ההסמכה פגה אצל: a')
  })
})
