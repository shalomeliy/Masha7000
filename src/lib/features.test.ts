import { describe, expect, it } from 'vitest'
import { ALL_ON, answersToFeatures, FEATURE_IDS, featureName, resolveFeatures, withFeature } from './features'

const onboarding = { version: 1 as const, answers: {}, doneAt: '2026-11-24' }

describe('features', () => {
  it('a team from before the wizard sees everything', () => {
    expect(resolveFeatures(undefined)).toEqual(ALL_ON)
    expect(resolveFeatures({ features: { vehicles: false } })).toEqual(ALL_ON)
  })

  it('after the wizard only what was saved as on, and a dependency follows its parent', () => {
    const f = resolveFeatures({ onboarding, features: { certs: false, certExpiry: true, vehicles: true } })
    expect(f.vehicles).toBe(true)
    expect(f.certExpiry).toBe(false)
    expect(f.shali).toBe(false) // never saved: a feature added later does not turn itself on
  })

  it('switching keeps dependencies consistent', () => {
    const off = withFeature(ALL_ON, 'constraints', false)
    expect(off.constraintForm).toBe(false)
    const on = withFeature({ ...ALL_ON, certs: false, certExpiry: false }, 'certExpiry', true)
    expect(on.certs).toBe(true)
  })

  it('maps the wizard answers as in the spec table', () => {
    const f = answersToFeatures({ shifts: 'day', certs: 'noExpiry', vehicles: 'no', departments: 'yes', constraints: 'tellMe', join: 'iType', closing: 'no', shali: 'yes' })
    expect(f).toMatchObject({ nightJobs: false, certs: true, certExpiry: false, vehicles: false, departments: true, constraints: true, constraintForm: false, joinForm: false, jobClosing: false, reports: false, shali: true, api: false })
    expect(answersToFeatures({ constraints: 'weeklyForm', certs: 'withExpiry' })).toMatchObject({ constraintForm: true, certExpiry: true })
    expect(answersToFeatures({ certs: 'no' }).certExpiry).toBe(false)
  })

  it('every feature has a name', () => {
    for (const id of FEATURE_IDS) expect(featureName(id)).toBeTruthy()
  })
})
