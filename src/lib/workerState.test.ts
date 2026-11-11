import { describe, expect, it } from 'vitest'
import { blockingConstraint, constraintText } from './constraints'
import { endAbsence, teamStates, workerState } from './workerState'
import type { Worker } from '../types/models'

const w = (over: Partial<Worker> = {}): Worker => ({ id: 'w', firstName: 'דני', lastName: 'לוי', certificationIds: [], constraints: [], ...over })
const TODAY = '2026-11-06'

describe('workerState', () => {
  it('fit by default', () => expect(workerState(w(), TODAY)).toEqual({ id: 'fit', label: 'כשיר לעבודה' }))

  it('sick until a day still to come; fit again after it', () => {
    expect(workerState(w({ status: 'sick', sickUntil: '2026-11-09' }), TODAY)).toEqual({ id: 'sick', label: 'במחלה עד 9.11' })
    expect(workerState(w({ status: 'sick', sickUntil: '2026-11-05' }), TODAY).id).toBe('fit')
  })

  it('on vacation today, with the last day; not yet before it starts', () => {
    const vacation = w({ constraints: [{ id: 'c', when: 'dates', from: '2026-11-05', to: '2026-11-12', kind: 'vacation' }] })
    expect(workerState(vacation, TODAY)).toEqual({ id: 'vacation', label: 'בחופש עד 12.11' })
    expect(workerState(vacation, '2026-11-04').id).toBe('fit')
  })

  it('an absence for today only still says until when', () => {
    const today = w({ constraints: [{ id: 'c', when: 'dates', from: TODAY, to: TODAY, kind: 'sick' }] })
    expect(workerState(today, TODAY)).toEqual({ id: 'sick', label: 'במחלה עד 6.11' })
  })

  it('a weekly study day shows only on that weekday', () => {
    const study = w({ constraints: [{ id: 'c', when: 'weekdays', weekdays: [5], kind: 'study' }] }) // Friday
    expect(workerState(study, TODAY)).toEqual({ id: 'study', label: 'בלימודים היום' })
    expect(workerState(study, '2026-11-07').id).toBe('fit')
  })

  it('a whole-day plain constraint today is "away"; its reason can name the absence', () => {
    const plain = w({ constraints: [{ id: 'c', when: 'dates', from: TODAY, to: '2026-11-25' }] })
    expect(workerState(plain, TODAY)).toEqual({ id: 'away', label: 'לא זמין עד 25.11' })
    expect(teamStates([plain, w()], TODAY)).toEqual([{ id: 'fit', count: 1 }, { id: 'away', count: 1 }])
    const noted = w({ constraints: [{ id: 'c', when: 'dates', from: TODAY, to: '2026-11-25', note: 'חופש משפחתי' }] })
    expect(workerState(noted, TODAY)).toEqual({ id: 'vacation', label: 'בחופש עד 25.11' })
  })

  it('a part of the day or nights only is not a state; inactive wins over everything', () => {
    expect(workerState(w({ constraints: [{ id: 'c', when: 'dates', from: TODAY, to: TODAY, part: 'evening' }] }), TODAY).id).toBe('fit')
    expect(workerState(w({ constraints: [{ id: 'c', when: 'dates', from: TODAY, to: TODAY, nightsOnly: true }] }), TODAY).id).toBe('fit')
    expect(workerState(w({ constraints: [{ id: 'c', when: 'always', nightsOnly: true }] }), TODAY).id).toBe('fit')
    expect(workerState(w({ status: 'inactive', constraints: [{ id: 'c', when: 'dates', from: TODAY, to: TODAY, kind: 'vacation' }] }), TODAY).id).toBe('inactive')
  })

  it('counts the team by state, in order', () => {
    const team = [w(), w({ status: 'sick', sickUntil: '2026-11-08' }), w(), w({ constraints: [{ id: 'c', when: 'dates', from: TODAY, to: TODAY, kind: 'reserve' }] })]
    expect(teamStates(team, TODAY)).toEqual([{ id: 'fit', count: 2 }, { id: 'sick', count: 1 }, { id: 'reserve', count: 1 }])
  })
})

describe('absences are constraints', () => {
  const vacation = { id: 'c', when: 'dates' as const, from: '2026-11-08', to: '2026-11-10', kind: 'vacation' as const }

  it('read as the kind', () => expect(constraintText(vacation)).toBe('בחופש 8.11 עד 10.11'))

  it('block a shift on those days', () => {
    const shift = { id: 's', date: '2026-11-09', shiftDefinitionId: 'day', location: '', jobDescription: '', crew: [], staffing: [] }
    const defs = [{ id: 'day', name: 'יום', requiredCertificationIds: [], startTime: '07:00', endTime: '16:00' }]
    expect(blockingConstraint(w({ constraints: [vacation] }), shift, defs)).toBe(vacation)
  })
})

describe('endAbsence', () => {
  it('ends an absence going on today yesterday, removes one starting today, keeps the rest', () => {
    const list = [
      { id: 'a', when: 'dates' as const, from: '2026-11-01', to: '2026-11-10', kind: 'vacation' as const },
      { id: 'b', when: 'dates' as const, from: TODAY, to: '2026-11-08', kind: 'study' as const },
      { id: 'c', when: 'dates' as const, from: TODAY, to: TODAY, part: 'evening' as const },
    ]
    expect(endAbsence(list, TODAY)).toEqual([{ ...list[0], to: '2026-11-05' }, list[2]])
  })
})
