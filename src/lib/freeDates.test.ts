import { describe, expect, it } from 'vitest'
import { applyProposal, proposalErrors, type AppData } from './assistant'
import { continueJob, handleFree, learn, pickedOption, type Local } from './freeCommands'
import type { Worker } from '../types/models'

const NOW = new Date('2026-11-08T10:00:00') // Sunday
const w = (id: string, firstName: string, roleIds: string[], constraints: Worker['constraints'] = []): Worker => ({ id, firstName, lastName: 'כהן', roleIds, certificationIds: [], constraints })

const data = (over: Partial<AppData> = {}): AppData => ({
  roles: [{ id: 'r1', name: 'טפסן' }, { id: 'r2', name: 'חשמלאי' }],
  certifications: [],
  workers: [
    w('w1', 'יוסי', ['r1'], [{ id: 'c1', when: 'dates', from: '2026-11-08', to: '2026-11-09' }]),
    w('w2', 'ניר', ['r1']),
    w('w3', 'דני', ['r2']),
  ],
  shiftDefinitions: [
    { id: 's1', name: 'יום', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00' },
    { id: 's2', name: 'לילה', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00', endsNextDay: true },
  ],
  shifts: [],
  pendingJobs: [],
  places: [{ id: 'p3', name: 'ערד 17' }],
  jobTypes: [{ id: 'j1', name: 'החלפת אנטנה' }],
  workKinds: [],
  postponeReasons: [],
  assistantNotes: [],
  departments: [],
  assistantExamples: [],
  ...over,
})
const run = (said: string, d = data()) => handleFree(said, d, learn(d.assistantExamples, d), NOW)
const advise = (r: Local) => (r?.kind === 'advise' ? r : null)

describe('"מתי יוסי וניר פנויים" by voice, free', () => {
  it('says the nearest days both are free, each a ready job', () => {
    const r = advise(run('תמצא לי מתי יוסי וניר פנויים לעבודת לילה בערד'))
    expect(r?.options.map((o) => o.title)).toEqual(['ביום שלישי 10.11', 'ביום רביעי 11.11', 'ביום חמישי 12.11'])
    expect(r?.spoken).toBe('יוסי וניר פנויים ביום שלישי 10.11, ביום רביעי 11.11 או ביום חמישי 12.11. איזה יום לקבוע, הראשון, השני או השלישי?')
    const p = r!.options[0].proposal!
    expect(p.jobs[0]).toMatchObject({ date: '2026-11-10', shiftKindId: 's2', location: 'ערד 17', autoAssign: true })
    expect(p.jobs[0].crew.map((c) => c.workerId)).toEqual(['w1', 'w2'])
    expect(proposalErrors(p, data())).toEqual([])
    // Saved, the two are pinned.
    const saved = applyProposal(p, data()).data.shifts[0]
    expect(saved.pinnedIds).toEqual(['w1', 'w2'])
    expect(pickedOption('השני', r!.options.length)).toBe(1)
  })

  it('fills the extra people said with others', () => {
    const r = advise(run('מתי יוסי וניר פנויים ביחד לעבודת יום בערד ועוד חשמלאי'))
    expect(r?.options[0].actions[0]).toBe('ייכנסו גם: דני')
    const saved = applyProposal(r!.options[0].proposal!, data()).data.shifts[0]
    expect(saved.crew.map((c) => c.workerId).sort()).toEqual(['w1', 'w2', 'w3'])
  })

  it('a place not in the lists, said with ב', () => {
    const r = advise(run('מתי ניר פנוי לעבודת יום בירוחם'))
    expect(r?.options[0].proposal?.jobs[0].location).toBe('ירוחם')
    expect(r?.options[0].title).toBe('היום')
  })

  it('asks the kind when it was not said, then gives the days', () => {
    const r = run('מתי יוסי וניר פנויים בערד')
    expect(r).toMatchObject({ kind: 'ask', question: 'איזו עבודה, יום, לילה?' })
    const d = data()
    const next = continueJob('לילה', (r as Extract<Local, { kind: 'ask' }>).pending, d, learn([], d), NOW)
    expect(advise(next)?.options[0].proposal?.jobs[0].shiftKindId).toBe('s2')
  })

  it('says so when there is no such day', () => {
    const d = data({ workers: [w('w1', 'יוסי', ['r1'], [{ id: 'c', when: 'always' }])] })
    expect(run('מתי יוסי פנוי לעבודת לילה בערד', d)).toMatchObject({ kind: 'say' })
  })

  it('anything more goes to Claude', () => {
    expect(run('מתי יוסי וניר פנויים לעבודת לילה בערד ולמה דני לא')).toBeNull()
    expect(run('מתי יוסי עובד')).toBeNull()
  })
})
