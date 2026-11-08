// The voice assistant's changes to what already exists: edit, move or schedule a job, set its crew,
// close or delete it, update a worker, add a constraint. Pure, by the same rules the screens use
// (moveShift, crewSwaps, applyClosure, pendingAfterShiftSave, busyCrew). Run once on a copy to find
// problems to send back to the model, and once for real after the manager says yes.

import { crewSwaps } from './archive'
import { fullName, isActive, MAX_STAFF, newId, upsert } from './catalog'
import { constraintError, constraintText, normalizeConstraint } from './constraints'
import { isRealDate } from './dates'
import { applyClosure, blankShift, isNightShift, moveShift, pendingAfterShiftSave } from './shifts'
import { endAbsence } from './workerState'
import type { AbsenceKind, Constraint, PendingJob, StaffSlot, Worker, WorkerStatus } from '../types/models'
import type { AppData } from './assistant'
import { tx } from '../i18n'
import { asTaskList, oneLine } from './taskList'

export interface StaffLine {
  count: number
  certificationIds: string[]
}

export interface EditJob {
  id: string // a job in the calendar, or a waiting one
  date: string // '' = unchanged; for a waiting job: put it in the calendar on this date
  shiftKindId: string // '' = unchanged
  location: string // '' = unchanged
  jobDescription: string // '' = unchanged
  staffing: StaffLine[] // [] = unchanged
  autoAssign: boolean
}

export interface Edits {
  editJobs: EditJob[]
  setCrews: { shiftId: string; crew: { workerId: string }[] }[]
  closeJobs: { shiftId: string; outcome: 'done' | 'partial' | 'postponed'; note: string }[]
  deleteJobIds: string[]
  editWorkers: {
    workerId: string
    mobilePhone: string // '' = unchanged
    addCertificationIds: string[]
    removeCertificationIds: string[]
    status: '' | 'active' | 'sick' | 'inactive' // '' = unchanged
    sickUntil: string // YYYY-MM-DD, with 'sick'
  }[]
  addConstraints: { workerId: string; from: string; to: string; nightsOnly: boolean; note: string; kind?: AbsenceKind | '' }[] // kind: חופש, לימודים...
}

export const NO_EDITS: Edits = { editJobs: [], setCrews: [], closeJobs: [], deleteJobIds: [], editWorkers: [], addConstraints: [] }

export const editCount = (e: Edits) =>
  e.editJobs.length + e.setCrews.length + e.closeJobs.length + e.deleteJobIds.length + e.editWorkers.length + e.addConstraints.length

/** One place per person, like a new job's staffing. */
export const linesToSlots = (lines: StaffLine[]): StaffSlot[] =>
  lines
    .flatMap((s) => Array.from({ length: Math.max(1, Math.round(s.count)) }, (): StaffSlot => (s.certificationIds.length ? { certificationIds: s.certificationIds } : {})))
    .slice(0, MAX_STAFF)

export interface EditResult {
  errors: string[] // Hebrew, for the model to fix (or to ask the manager)
  warnings: string[] // Hebrew, said after saving
  report: string[]
  toAssign: string[] // shift ids to fill automatically
  touched: string[] // shift ids whose crew or date changed: checked for workers in two jobs at once
}

const has = (list: { id: string }[], id: string) => list.some((x) => x.id === id)

/** Applies `e` to `d` in place (d is the caller's copy). */
export function applyEdits(e: Edits, d: AppData, at: string, changed: Set<keyof AppData>): EditResult {
  const errors: string[] = []
  const warnings: string[] = []
  const report: string[] = []
  const toAssign: string[] = []
  const touched = new Set<string>()
  const where = (r: { location: string; jobDescription: string }) => r.location || oneLine(r.jobDescription) || 'העבודה'
  const lineErrors = (lines: StaffLine[], n: string) => {
    for (const s of lines) {
      for (const c of s.certificationIds) if (!has(d.certifications, c)) errors.push(`${n}: אין הסמכה עם id "${c}"`)
    }
  }

  // Workers first: a job may need the certification just given.
  for (const w of e.editWorkers) {
    const worker = d.workers.find((x) => x.id === w.workerId)
    if (!worker) {
      errors.push(`אין עובד עם id "${w.workerId}"`)
      continue
    }
    for (const c of [...w.addCertificationIds, ...w.removeCertificationIds]) if (!has(d.certifications, c)) errors.push(`${worker.firstName}: אין הסמכה עם id "${c}"`)
    if (w.status === 'sick' && !isRealDate(w.sickUntil)) errors.push(`${worker.firstName}: חולה עד איזה תאריך?`)
    const status: WorkerStatus | undefined = w.status === '' ? worker.status : w.status === 'active' ? undefined : w.status
    const next: Worker = {
      ...worker,
      mobilePhone: w.mobilePhone ? w.mobilePhone.replace(/[^\d+]/g, '') : worker.mobilePhone,
      certificationIds: [...new Set([...worker.certificationIds.filter((c) => !w.removeCertificationIds.includes(c)), ...w.addCertificationIds])],
      status,
      sickUntil: status === 'sick' ? w.sickUntil || worker.sickUntil : undefined,
      // "חזר לעבוד" also ends a vacation or the like going on today.
      constraints: w.status === 'active' ? endAbsence(worker.constraints, at.slice(0, 10)) : worker.constraints,
    }
    d.workers = upsert(d.workers, next)
    changed.add('workers')
    report.push(tx('עדכנתי את {firstName}', { firstName: worker.firstName }))
  }

  for (const c of e.addConstraints) {
    const worker = d.workers.find((x) => x.id === c.workerId)
    if (!worker) {
      errors.push(`אין עובד עם id "${c.workerId}"`)
      continue
    }
    // Normalized now, not only on the next load: a day with the note "מחלה" ("חולה ביום שלישי") is sickness.
    const constraint: Constraint = normalizeConstraint({
      id: newId(),
      when: 'dates',
      from: c.from,
      to: c.to || c.from,
      ...(c.kind ? { kind: c.kind } : c.nightsOnly ? { nightsOnly: true } : {}),
      ...(c.note.trim() ? { note: c.note.trim() } : {}),
    })
    const err = constraintError(constraint)
    if (err) {
      errors.push(`אילוץ של ${worker.firstName}: ${err}`)
      continue
    }
    d.workers = upsert(d.workers, { ...worker, constraints: [...worker.constraints, constraint] })
    changed.add('workers')
    report.push(constraint.kind ? tx('רשמתי ש{firstName} {v}', { firstName: worker.firstName, v: constraintText(constraint) }) : tx('רשמתי אילוץ ל{firstName}', { firstName: worker.firstName }))
  }

  e.editJobs.forEach((j, i) => {
    const n = `עריכה ${i + 1}`
    if (j.date && !isRealDate(j.date)) errors.push(`${n}: תאריך לא תקין "${j.date}"`)
    if (j.shiftKindId && !has(d.shiftDefinitions, j.shiftKindId)) errors.push(`${n}: אין תבנית עבודה עם id "${j.shiftKindId}"`)
    lineErrors(j.staffing, n)
    const fields = <T extends { location: string; jobDescription: string; staffing: StaffSlot[]; shiftDefinitionId?: string; workKindIds?: string[] }>(r: T): T => ({
      ...r,
      ...(j.location.trim() ? { location: j.location.trim() } : {}),
      ...(j.jobDescription.trim() ? { jobDescription: asTaskList(j.jobDescription) } : {}),
      ...(j.shiftKindId ? { shiftDefinitionId: j.shiftKindId } : {}),
      ...(j.staffing.length ? { staffing: linesToSlots(j.staffing), workKindIds: undefined } : {}),
    })
    const shift = d.shifts.find((s) => s.id === j.id)
    const job = d.pendingJobs.find((p) => p.id === j.id)
    if (shift) {
      let next = fields(shift)
      if (j.date && j.date !== shift.date) next = moveShift(next, j.date)
      if (shift.closure && !isNightShift(next, d.shiftDefinitions)) errors.push(`${n}: העבודה ב${where(shift)} כבר נסגרה, ולכן היא נשארת עבודת לילה`)
      if (!d.shiftDefinitions.find((s) => s.id === next.shiftDefinitionId)?.thenJob) next = { ...next, nextJob: undefined }
      d.shifts = upsert(d.shifts, next)
      d.pendingJobs = pendingAfterShiftSave(d.pendingJobs, next)
      changed.add('shifts').add('pendingJobs')
      touched.add(next.id)
      if (j.autoAssign) toAssign.push(next.id)
      report.push(j.date && j.date !== shift.date ? tx('הזזתי את העבודה ב{v}', { v: where(next) }) : tx('עדכנתי את העבודה ב{v}', { v: where(next) }))
    } else if (job) {
      const edited: PendingJob = fields(job)
      if (j.date) {
        const created = fields(blankShift(j.date, edited))
        d.shifts = [...d.shifts, created]
        d.pendingJobs = pendingAfterShiftSave(upsert(d.pendingJobs, edited), created)
        changed.add('shifts').add('pendingJobs')
        if (j.autoAssign) toAssign.push(created.id)
        report.push(tx('שיבצתי ליומן את העבודה ב{v}', { v: where(created) }))
      } else {
        d.pendingJobs = upsert(d.pendingJobs, edited)
        changed.add('pendingJobs')
        if (j.autoAssign) errors.push(`${n}: אפשר לשבץ עובדים רק לעבודה עם תאריך`)
        report.push(tx('עדכנתי את העבודה הממתינה ב{v}', { v: where(edited) }))
      }
    } else errors.push(`${n}: אין עבודה עם id "${j.id}"`)
  })

  for (const c of e.setCrews) {
    const shift = d.shifts.find((s) => s.id === c.shiftId)
    if (!shift) {
      errors.push(`אין עבודה ביומן עם id "${c.shiftId}"`)
      continue
    }
    const ok = c.crew.map((m) => {
      const w = d.workers.find((x) => x.id === m.workerId)
      if (!w) errors.push(`אין עובד עם id "${m.workerId}"`)
      else if (!isActive(w)) errors.push(`${fullName(w)} לא פעיל`)
      else return true
      return false
    }).every(Boolean)
    if (!ok) continue
    const crew = c.crew.filter((m, i) => c.crew.findIndex((x) => x.workerId === m.workerId) === i)
    const swaps = crewSwaps(shift.crew, crew, at)
    d.shifts = upsert(d.shifts, { ...shift, crew, ...(swaps.length ? { swaps: [...(shift.swaps ?? []), ...swaps] } : {}) })
    changed.add('shifts')
    touched.add(shift.id)
    report.push(crew.length ? tx('ב{v} שמתי את {v2}', { v: where(shift), v2: crew.map((m) => d.workers.find((w) => w.id === m.workerId)?.firstName).join(', ') }) : tx('ב{v} הורדתי את כל העובדים', { v: where(shift) }))
  }

  // A worker in two jobs at once is handled by the caller (applyProposal: the manager is warned and
  // confirms moving him); being sick is only a warning.
  for (const id of touched) {
    const shift = d.shifts.find((s) => s.id === id)
    if (!shift) continue
    for (const m of shift.crew) {
      const w = d.workers.find((x) => x.id === m.workerId)
      if (w?.status === 'sick' && w.sickUntil && w.sickUntil >= shift.date) warnings.push(tx('שים לב, {firstName} רשום חולה עד {v}.{v2}', { firstName: w.firstName, v: w.sickUntil.slice(8), v2: Number(w.sickUntil.slice(5, 7)) }))
    }
  }

  for (const c of e.closeJobs) {
    const shift = d.shifts.find((s) => s.id === c.shiftId)
    if (!shift) {
      errors.push(`אין עבודה ביומן עם id "${c.shiftId}"`)
      continue
    }
    if (!isNightShift(shift, d.shiftDefinitions)) {
      errors.push(`סוגרים רק עבודות לילה, והעבודה ב${where(shift)} היא עבודת יום`)
      continue
    }
    const out = applyClosure(d.shifts, d.pendingJobs, shift.id, { outcome: c.outcome, reasonIds: [], closedAt: at, ...(c.note.trim() ? { note: c.note.trim() } : {}) })
    d.shifts = out.records
    d.pendingJobs = out.pending
    changed.add('shifts').add('pendingJobs')
    report.push(c.outcome === 'done' ? tx('סגרתי את העבודה ב{v} כבוצעה', { v: where(shift) }) : tx('סגרתי את העבודה ב{v}, והמשך שלה מחכה בלשיבוץ', { v: where(shift) }))
  }

  for (const id of e.deleteJobIds) {
    const shift = d.shifts.find((s) => s.id === id)
    const job = d.pendingJobs.find((p) => p.id === id)
    if (shift) {
      // A job scheduled into it comes back to "לשיבוץ" by itself (isWaiting).
      d.shifts = d.shifts.filter((s) => s.id !== id)
      changed.add('shifts')
      report.push(tx('מחקתי את העבודה ב{v}{v2}', { v: where(shift), v2: shift.fromJobId ? tx(', והיא חזרה לרשימת הממתינות') : '' }))
    } else if (job) {
      d.pendingJobs = d.pendingJobs.filter((p) => p.id !== id)
      changed.add('pendingJobs')
      report.push(tx('מחקתי את העבודה הממתינה ב{v}', { v: where(job) }))
    } else errors.push(`אין עבודה עם id "${id}" למחיקה`)
  }

  return { errors, warnings, report, toAssign, touched: [...touched] }
}
