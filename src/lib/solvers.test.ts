import { describe, expect, it } from 'vitest'
import { applyProposal, proposalErrors, type AppData, type Proposal } from './assistant'
import { NO_EDITS } from './assistantEdits'
import { optionsText, preferenceLesson, solve } from './solvers'
import type { ShiftRecord, Worker } from '../types/models'

const w = (id: string, firstName: string, roleIds: string[], extra: Partial<Worker> = {}): Worker => ({ id, firstName, lastName: 'כהן', roleIds, certificationIds: [], constraints: [], ...extra })
const job = (id: string, date: string, crew: string[], staffing: ShiftRecord['staffing']): ShiftRecord => ({
  id, date, shiftDefinitionId: 'day', location: id, jobDescription: '', crew: crew.map((workerId) => ({ workerId, roleId: 'climb' })), staffing,
})
const H40 = { roleId: 'climb', certificationIds: ['h40'] }

// Sunday 8.11: Eilat needs a 40m climber and another climber. Dani (40m) is out; Omer (40m) is sick until 10.11.
const data = (): AppData => ({
  roles: [{ id: 'general', name: 'כללי' }, { id: 'climb', name: 'טפסן' }],
  certifications: [{ id: 'h40', name: 'גובה 40' }],
  workers: [
    w('dani', 'דני', ['climb'], { certificationIds: ['h40'] }),
    w('yossi', 'יוסי', ['climb']),
    w('omer', 'עומר', ['climb'], { certificationIds: ['h40'], status: 'sick', sickUntil: '2026-11-10' }),
    w('gil', 'גיל', ['climb']),
  ],
  shiftDefinitions: [{ id: 'day', name: 'יום', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00' }],
  shifts: [job('אילת', '2026-11-08', ['dani', 'yossi'], [H40, { roleId: 'climb' }])],
  pendingJobs: [],
  places: [],
  jobTypes: [],
  workKinds: [],
  postponeReasons: [],
  assistantNotes: [],
  departments: [],
  assistantExamples: [],
})
const NOW = new Date('2026-11-06T20:00:00')
const asProposal = (changes: Proposal['editJobs'] extends never ? never : typeof NO_EDITS): Proposal => ({
  summary: 'x', jobs: [], assignShiftIds: [], workers: [], listItems: [], rememberNotes: [], lessons: [], forgetNoteIds: [], ...changes,
})

describe('solve: a worker drops out', () => {
  it('no 40m climber on Sunday: move to the first day Omer is back, or go short', () => {
    const options = solve(data(), { kind: 'missing', shiftId: 'אילת', workerIds: ['dani'] })
    expect(options.map((o) => [o.kind, o.title])).toEqual([
      ['move', 'להזיז ליום רביעי 11.11'],
      ['short', 'לצאת בצוות חסר'],
    ])
    // The move carries itself out, and the app accepts it.
    const p = asProposal(options[0].changes)
    expect(proposalErrors(p, data())).toEqual([])
    const after = applyProposal(p, data(), NOW).data.shifts[0]
    expect(after.date).toBe('2026-11-11')
    expect(after.crew).toHaveLength(2)
    expect(after.crew.map((c) => c.workerId)).toContain('omer') // the 40m place
  })

  it('a replacement who fits: put him in', () => {
    const d = data()
    d.workers.push(w('avi', 'אבי', ['climb'], { certificationIds: ['h40'] }))
    const [first] = solve(d, { kind: 'missing', shiftId: 'אילת', workerIds: ['dani'] })
    expect(first.kind).toBe('replace')
    expect(first.changes.setCrews[0].crew.map((c) => c.workerId).sort()).toEqual(['avi', 'yossi'])
  })
})

describe('solve: a day short of people', () => {
  it('fills job by job, never the same worker twice that day', () => {
    const d = data()
    d.shifts = [job('א', '2026-11-08', [], [{ roleId: 'climb' }]), job('ב', '2026-11-08', [], [{ roleId: 'climb' }])]
    const [first] = solve(d, { kind: 'day', date: '2026-11-08' })
    const ids = first.changes.setCrews.flatMap((c) => c.crew.map((m) => m.workerId))
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(proposalErrors(asProposal(first.changes), d)).toEqual([])
  })

  it('nothing to solve on a full day', () => expect(solve(data(), { kind: 'day', date: '2026-11-08' })).toEqual([]))
})

describe('wording and learning', () => {
  it('no options: the model solves it itself', () => expect(optionsText([])).toContain('advise'))
  it('a rule only when the manager picks another kind than the top one', () => {
    expect(preferenceLesson('missing', 'move', 'move')).toBeNull()
    expect(preferenceLesson('missing', 'short', 'move')).toBe('כשעובד נופל מעבודה, המנהל מעדיף לצאת בצוות חסר, ולא להזיז את העבודה ליום שבו יש צוות מלא')
  })
})
