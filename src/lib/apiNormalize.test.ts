import { describe, expect, it } from 'vitest'
import * as server from '../../api/_lib/v1/normalize.js'
import { certStars, normalizeWorker, slotCerts, withGeneralCert } from './catalog'
import { normalizeConstraint } from './constraints'
import { normalizePendingJob, normalizeShiftRecord } from './shifts'
import type { Worker } from '../types/models'

// The outside API keeps its own copies of the app's read-time upgrades (api/ cannot import src/).
// Both run here on the same old and new file shapes, so a change to one without the other fails.

const strip = <T>(x: T) => JSON.parse(JSON.stringify(x)) as T

const workers = [
  { id: 'a', name: 'דני לוי', phone: '050', roleIds: ['r'], certificationIds: ['c1'] },
  { id: 'b', firstName: 'אבי', lastName: 'כהן', certificationIds: ['general', 'c1'], certRatings: { c1: 3, x: 9 }, constraints: [{ id: 'k', date: '2026-11-01', reason: ' חופש ' }], status: 'sick' as const, sickUntil: '2026-11-03' },
  { id: 'c', firstName: 'יוסי', lastName: '', certificationIds: [], constraints: [{ id: 'k2', when: 'weekdays' as const, weekdays: [1], from: '' }, { id: 'k3', when: 'always' as const }, { id: 'k4', from: '2026-11-02', note: 'מחלה' }] },
]

describe('server copies of the read upgrades', () => {
  it('workers and constraints', () => {
    for (const w of workers) expect(strip(server.normalizeWorker(w))).toEqual(strip(normalizeWorker(w as never)))
  })
  it('stars, slots and certifications', () => {
    const w = workers[1] as Pick<Worker, 'certRatings'>
    for (const id of ['c1', 'x', 'none']) expect(server.certStars(w, id)).toBe(certStars(w, id))
    for (const s of [{}, { certificationId: 'c' }, { certificationIds: ['a', 'b'] }]) expect(server.slotCerts(s)).toEqual(slotCerts(s))
    expect(server.withGeneralCert([{ id: 'c1', name: 'x' }])).toEqual(withGeneralCert([{ id: 'c1', name: 'x' }]))
  })
  it('shifts and pending jobs', () => {
    const shift = { id: 's', date: '2026-11-01' }
    expect(server.normalizeShiftRecord(shift)).toEqual(normalizeShiftRecord(shift))
    const job = { id: 'j', location: 'ערד' }
    expect(server.normalizePendingJob(job)).toEqual(normalizePendingJob(job))
  })
  it('a constraint alone', () => {
    const c = { id: 'k', when: 'dates' as const, from: '2026-11-01' }
    expect(strip(server.normalizeConstraint(c))).toEqual(strip(normalizeConstraint(c)))
  })
})
