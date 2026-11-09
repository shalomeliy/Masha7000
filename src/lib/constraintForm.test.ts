import { describe, expect, it } from 'vitest'
import { applyAnswers, constraintCodeOf, dayAnswer, dayChoiceOf, rosterOf, withoutMobile, type ConstraintAnswer } from './constraintForm'
import { answersToConstraints } from './constraints'
import type { Worker } from '../types/models'

const worker = (id: string, extra: Partial<Worker> = {}): Worker => ({ id, firstName: id, lastName: 'x', certificationIds: [], constraints: [], status: 'active', ...extra })
const answer = (workerId: string, days: string[], extra: Partial<ConstraintAnswer> = {}): ConstraintAnswer => ({ id: `a-${workerId}-${extra.at ?? 1}`, at: 1, workerId, weekStart: '2026-11-15', days, ...extra })
const week = (d: Record<number, string>) => Array.from({ length: 7 }, (_, i) => d[i] ?? '')

describe('weekly constraints form', () => {
  it('reads the link', () => {
    expect(constraintCodeOf('/constraints/abcdefgh12')).toBe('abcdefgh12')
    expect(constraintCodeOf('/join/abcdefgh12')).toBeNull()
  })

  it('a quick choice and a reason become words the reader understands', () => {
    expect(dayAnswer({ part: 'evening', text: ' חתונה ', weekly: false })).toBe('לא יכול בערב, חתונה')
    expect(dayAnswer({ text: 'לימודים', weekly: true })).toBe('לימודים, כל שבוע')
    expect(dayAnswer({ text: '  ', weekly: true })).toBe('')
    const [evening, study, night, whole] = answersToConstraints(
      week({ 1: dayAnswer({ part: 'evening', text: 'חתונה', weekly: false }), 2: 'לימודים, כל שבוע', 3: dayAnswer({ part: 'night', text: '', weekly: false }), 4: dayAnswer({ part: 'whole', text: '', weekly: false }) }),
      '2026-11-15',
    )
    expect(evening).toMatchObject({ when: 'dates', from: '2026-11-16', part: 'evening', reply: '2026-11-15' })
    expect(study).toMatchObject({ when: 'weekdays', weekdays: [2], from: '2026-11-17' })
    expect(night).toMatchObject({ from: '2026-11-18', nightsOnly: true })
    expect(whole).toMatchObject({ from: '2026-11-19' })
    expect(whole.part).toBeUndefined()
  })

  it('a sent answer opens back as the same choices', () => {
    for (const d of [
      { part: 'evening' as const, text: 'חתונה', weekly: false },
      { part: 'whole' as const, text: '', weekly: true },
      { text: 'לימודים, אחר הצהריים', weekly: true },
      { text: 'כל שבוע', weekly: false },
      { text: '', weekly: false },
    ])
      expect(dayChoiceOf(dayAnswer(d))).toEqual(d)
  })

  it('knows only active workers with a valid mobile', () => {
    const list = [worker('a', { mobilePhone: '050-123-4567' }), worker('b'), worker('c', { mobilePhone: '0501112222', status: 'inactive' })]
    expect(rosterOf(list)).toEqual([{ id: 'a', firstName: 'a', phone: '0501234567' }])
    expect(withoutMobile(list).map((w) => w.id)).toEqual(['b'])
  })

  it('writes answers into the worker; a second answer for the week replaces the first', () => {
    const kept = { id: 'k', when: 'dates' as const, from: '2026-11-16', to: '2026-11-16' } // added by hand
    const list = [worker('a', { constraints: [kept], notes: 'old note' }), worker('b')]
    const first = applyAnswers(list, [answer('a', week({ 0: 'חופש' }), { notes: 'אני בצפון' }), answer('gone', week({ 0: 'חופש' }))])
    expect(first.used).toHaveLength(2)
    const a = first.workers[0]
    expect(a.constraints.map((c) => c.from)).toEqual(['2026-11-16', '2026-11-15'])
    expect(a.notes).toBe('old note\nאילוצים לשבוע 15.11: אני בצפון')
    expect(first.workers[1]).toEqual(list[1])
    const again = applyAnswers(first.workers, [answer('a', week({ 5: 'לא יכול' }), { at: 2 })]).workers[0]
    expect(again.constraints.map((c) => c.from)).toEqual(['2026-11-16', '2026-11-20'])
    expect(again.notes).toBe('old note')
  })
})
