import { afterEach, describe, expect, it } from 'vitest'
import { staffingFor } from './catalog'
import { applyFeatureRules } from './featureRules'
import { autoAssign } from './planner'
import type { ShiftRecord, Worker } from '../types/models'

const worker = (id: string, certs: string[], constraints: Worker['constraints'] = []): Worker => ({ id, firstName: id, lastName: 'x', certificationIds: certs, constraints })
const shift: ShiftRecord = { id: 's1', date: '2026-12-01', location: 'a', jobDescription: 'b', crew: [], staffing: [{ certificationIds: ['climb'] }] }
const on = { certs: true, certExpiry: true, constraints: true }

describe('feature rules in "שבץ"', () => {
  afterEach(() => applyFeatureRules(on))

  it('certifications off: a worker without the certification fills the place, and the job keeps it', () => {
    const ctx = { workers: [worker('noCert', [])], records: [], defs: [] }
    const staffing = staffingFor(shift.staffing, ['climb'])
    expect(autoAssign(shift, staffing, ctx).crew).toHaveLength(0)
    applyFeatureRules({ ...on, certs: false })
    expect(autoAssign(shift, staffing, ctx).crew.map((c) => c.workerId)).toEqual(['noCert'])
    expect(staffing[0].certificationIds).toEqual(['climb'])
  })

  it('constraints off: a day off no longer blocks', () => {
    const free = { ...shift, staffing: [{}] }
    const away = worker('away', [], [{ id: 'c', when: 'dates', from: '2026-12-01', to: '2026-12-01' }])
    const ctx = { workers: [away], records: [], defs: [] }
    expect(autoAssign(free, [{}], ctx).crew).toHaveLength(0)
    applyFeatureRules({ ...on, constraints: false })
    expect(autoAssign(free, [{}], ctx).crew).toHaveLength(1)
  })
})
