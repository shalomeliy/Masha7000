// The voice assistant, app side: the snapshot of the lists sent with each turn, and checking and
// applying a proposal the manager confirmed. Pure, so it is tested without Drive or the server.
// The server (api/_lib/assistant.ts) only proposes; every change is made here, by the same rules
// the screens use.

import { fullName, generalRoleId, isActive, MAX_STAFF, nameError, newId, staffingFor, upsert } from './catalog'
import { todayIso } from './dates'
import { autoAssign } from './planner'
import { addDays, dayName, isWaiting } from './shifts'
import { toggleKind } from './workKinds'
import type {
  Certification,
  JobType,
  PendingJob,
  Place,
  PostponeReason,
  Role,
  ShiftDefinition,
  ShiftRecord,
  StaffSlot,
  WorkKind,
  Worker,
} from '../types/models'

export interface AppData {
  roles: Role[]
  certifications: Certification[]
  workers: Worker[]
  shiftDefinitions: ShiftDefinition[]
  shifts: ShiftRecord[]
  pendingJobs: PendingJob[]
  places: Place[]
  jobTypes: JobType[]
  workKinds: WorkKind[]
  postponeReasons: PostponeReason[]
}

export type ListName = 'places' | 'jobTypes' | 'roles' | 'certifications' | 'postponeReasons'
export type Screen = 'calendar' | 'toSchedule' | 'workers' | 'archive' | 'settings'

export interface ProposedJob {
  date: string // '' = to the waiting list
  shiftKindId: string
  location: string
  jobDescription: string
  staffing: { roleId: string; count: number; certificationIds: string[] }[]
  workKindIds: string[]
  note: string
  autoAssign: boolean
}

export interface Proposal {
  summary: string
  jobs: ProposedJob[]
  assignShiftIds: string[]
  workers: { firstName: string; lastName: string; mobilePhone: string; roleIds: string[]; certificationIds: string[] }[]
  listItems: { list: ListName; name: string }[]
}

// Shifts this far back and ahead go to the assistant; enough for "מי עבד אתמול" and the coming weeks.
const PAST_DAYS = 7
const AHEAD_DAYS = 28

const named = (items: { id: string; name: string }[]) => items.map(({ id, name }) => ({ id, name }))

/** What the assistant knows: the lists, active workers, near shifts and waiting jobs. Ids for ids only. */
export function snapshot(d: AppData, now = new Date()) {
  const today = todayIso(now)
  const from = addDays(today, -PAST_DAYS)
  const to = addDays(today, AHEAD_DAYS)
  const name = (id: string, list: { id: string; name: string }[]) => list.find((x) => x.id === id)?.name ?? ''
  const workerName = (id: string) => {
    const w = d.workers.find((x) => x.id === id)
    return w ? fullName(w) : ''
  }
  const certIds = d.certifications.map((c) => c.id)
  const staffingNames = (staffing: StaffSlot[]) =>
    staffingFor(staffing, d.roles, certIds).map((s) => name(s.roleId, d.roles))
  return {
    today: `${today} (יום ${dayName(today)})`,
    roles: named(d.roles),
    certifications: named(d.certifications),
    shiftKinds: d.shiftDefinitions.map((s) => ({ id: s.id, name: s.name, night: Boolean(s.endsNextDay || s.thenJob) })),
    workKinds: d.workKinds.map((k) => ({ id: k.id, name: k.name, people: staffingNames(k.staffing) })),
    places: d.places.map((p) => p.name),
    jobTypes: d.jobTypes.map((j) => j.name),
    postponeReasons: d.postponeReasons.map((r) => r.name),
    workers: d.workers.filter(isActive).map((w) => ({
      id: w.id,
      name: fullName(w),
      mobile: w.mobilePhone ?? '',
      roles: w.roleIds.map((id) => name(id, d.roles)).filter(Boolean),
      certifications: w.certificationIds.map((id) => name(id, d.certifications)).filter(Boolean),
      ...(w.status === 'sick' ? { sickUntil: w.sickUntil ?? '' } : {}),
    })),
    shifts: d.shifts
      .filter((s) => s.date >= from && s.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => ({
        id: s.id,
        date: `${s.date} (יום ${dayName(s.date)})`,
        kind: s.urgent ? 'דחופה' : name(s.shiftDefinitionId ?? '', d.shiftDefinitions),
        location: s.location,
        job: s.jobDescription,
        needs: staffingNames(s.staffing),
        crew: s.crew.map((c) => `${workerName(c.workerId)} (${name(c.roleId, d.roles)})`),
        ...(s.closure ? { closed: s.closure.outcome } : {}),
      })),
    waitingJobs: d.pendingJobs
      .filter((j) => isWaiting(j, d.shifts))
      .map((j) => ({ location: j.location, job: j.jobDescription, kind: name(j.shiftDefinitionId ?? '', d.shiftDefinitions), needs: staffingNames(j.staffing) })),
  }
}

/** Hebrew problems with a proposal (unknown ids, bad dates, missing names), to send back to the assistant. */
export function proposalErrors(p: Proposal, d: AppData): string[] {
  const errors: string[] = []
  const has = (list: { id: string }[], id: string) => list.some((x) => x.id === id)
  p.jobs.forEach((j, i) => {
    const n = `עבודה ${i + 1}`
    if (j.date && !/^\d{4}-\d{2}-\d{2}$/.test(j.date)) errors.push(`${n}: תאריך לא תקין "${j.date}"`)
    if (!has(d.shiftDefinitions, j.shiftKindId)) errors.push(`${n}: אין תבנית עבודה עם id "${j.shiftKindId}"`)
    if (!j.location.trim() && !j.jobDescription.trim()) errors.push(`${n}: חסרים מקום ומהות עבודה`)
    for (const s of j.staffing) {
      if (!has(d.roles, s.roleId)) errors.push(`${n}: אין תפקיד עם id "${s.roleId}"`)
      if (!(s.count >= 1)) errors.push(`${n}: מספר אנשים לא תקין`)
      for (const c of s.certificationIds) if (!has(d.certifications, c)) errors.push(`${n}: אין הסמכה עם id "${c}"`)
    }
    for (const k of j.workKindIds) if (!has(d.workKinds, k)) errors.push(`${n}: אין סוג עבודה עם id "${k}"`)
    if (j.autoAssign && !j.date) errors.push(`${n}: אפשר לשבץ עובדים רק לעבודה עם תאריך`)
  })
  for (const id of p.assignShiftIds) if (!has(d.shifts, id)) errors.push(`אין עבודה ביומן עם id "${id}"`)
  p.workers.forEach((w, i) => {
    if (!w.firstName.trim()) errors.push(`עובד ${i + 1}: חסר שם פרטי`)
    for (const r of w.roleIds) if (!has(d.roles, r)) errors.push(`עובד ${i + 1}: אין תפקיד עם id "${r}"`)
    for (const c of w.certificationIds) if (!has(d.certifications, c)) errors.push(`עובד ${i + 1}: אין הסמכה עם id "${c}"`)
  })
  for (const item of p.listItems) {
    const e = nameError(item.name, d[item.list])
    if (e) errors.push(`"${item.name}": ${e}`)
  }
  const total = p.jobs.length + p.assignShiftIds.length + p.workers.length + p.listItems.length
  if (total === 0) errors.push('אין בהצעה שום שינוי')
  return errors
}

/** The job's places: one per person, then the places of its work kinds. Never more than MAX_STAFF. */
export function jobStaffing(j: ProposedJob, d: AppData): { staffing: StaffSlot[]; workKindIds: string[] } {
  const general = generalRoleId(d.roles)
  let job: { staffing: StaffSlot[]; workKindIds: string[] } = {
    staffing: j.staffing.flatMap((s) =>
      Array.from({ length: Math.max(1, Math.round(s.count)) }, () => ({ roleId: s.roleId, ...(s.certificationIds.length ? { certificationIds: s.certificationIds } : {}) })),
    ),
    workKindIds: [],
  }
  for (const id of j.workKindIds) {
    const kind = d.workKinds.find((k) => k.id === id)
    if (kind) job = toggleKind(job, kind, general)
  }
  if (!job.staffing.length) job.staffing = [{ roleId: general }]
  return { staffing: job.staffing.slice(0, MAX_STAFF), workKindIds: job.workKindIds }
}

export interface Applied {
  data: AppData
  changed: Set<keyof AppData>
  report: string[] // Hebrew, spoken after saving: what was done and what could not be
}

/** The data after the confirmed proposal; the caller saves each list in `changed`. */
export function applyProposal(p: Proposal, before: AppData, now = new Date()): Applied {
  const d: AppData = { ...before }
  const changed = new Set<keyof AppData>()
  const report: string[] = []
  const general = generalRoleId(d.roles)
  const at = now.toISOString()

  for (const item of p.listItems) {
    const list = d[item.list] as { id: string; name: string }[]
    d[item.list] = [...list, { id: newId(), name: item.name.trim() }] as never
    changed.add(item.list)
  }
  if (p.listItems.length) report.push(p.listItems.length === 1 ? 'הוספתי פריט לרשימה' : `הוספתי ${p.listItems.length} פריטים לרשימות`)

  for (const w of p.workers) {
    d.workers = [
      ...d.workers,
      {
        id: newId(),
        firstName: w.firstName.trim(),
        lastName: w.lastName.trim(),
        mobilePhone: w.mobilePhone.replace(/[^\d+]/g, '') || undefined,
        roleIds: w.roleIds.filter((r) => r !== general),
        certificationIds: w.certificationIds,
        constraints: [],
      },
    ]
    changed.add('workers')
  }
  if (p.workers.length) report.push(p.workers.length === 1 ? `הוספתי את ${p.workers[0].firstName} לעובדים` : `הוספתי ${p.workers.length} עובדים`)

  const toAssign = [...p.assignShiftIds]
  let calendar = 0
  let waiting = 0
  for (const j of p.jobs) {
    const { staffing, workKindIds } = jobStaffing(j, d)
    const base = {
      id: newId(),
      location: j.location.trim(),
      jobDescription: j.jobDescription.trim(),
      staffing,
      shiftDefinitionId: j.shiftKindId,
      ...(workKindIds.length ? { workKindIds } : {}),
    }
    if (j.date) {
      d.shifts = [...d.shifts, { ...base, date: j.date, crew: [] }]
      changed.add('shifts')
      calendar++
      if (j.autoAssign) toAssign.push(base.id)
    } else {
      d.pendingJobs = [...d.pendingJobs, { ...base, reasonIds: [], createdAt: at, ...(j.note.trim() ? { note: j.note.trim() } : {}) }]
      changed.add('pendingJobs')
      waiting++
    }
  }
  if (calendar) report.push(calendar === 1 ? 'הוספתי עבודה ליומן' : `הוספתי ${calendar} עבודות ליומן`)
  if (waiting) report.push(waiting === 1 ? 'הוספתי עבודה לרשימת הממתינות' : `הוספתי ${waiting} עבודות לרשימת הממתינות`)

  for (const id of toAssign) {
    const shift = d.shifts.find((s) => s.id === id)
    if (!shift) continue
    const staffing = staffingFor(shift.staffing, d.roles, d.certifications.map((c) => c.id))
    const plan = autoAssign(shift, staffing, { workers: d.workers, records: d.shifts, defs: d.shiftDefinitions, generalId: general })
    d.shifts = upsert(d.shifts, { ...shift, crew: plan.crew })
    changed.add('shifts')
    const where = shift.location || shift.jobDescription
    const names = plan.crew.map((c) => d.workers.find((w) => w.id === c.workerId)).filter((w): w is Worker => Boolean(w)).map((w) => w.firstName)
    report.push(names.length ? `ב${where} שיבצתי את ${names.join(', ')}` : `ב${where} לא מצאתי עובדים מתאימים`)
    if (plan.unfilled.length && names.length) report.push(`ב${where} נשארו ${plan.unfilled.length === 1 ? 'מקום אחד פנוי' : `${plan.unfilled.length} מקומות פנויים`}`)
  }
  return { data: d, changed, report }
}

// "כן", "מאשר", "תאשר", "בצע", "סגור" and the like, said alone, after a proposal.
const YES = /^(כן|כן כן|מאשר|אשר|תאשר|אישור|מאושר|בצע|תבצע|סגור|יאללה|אוקיי|אוקי|בסדר|נכון|יופי|סבבה|כן לאשר|כן תאשר|כן מאשר|לאשר)$/
export const isYes = (said: string) => YES.test(said.trim().replace(/[.,!?]/g, '').replace(/\s+/g, ' '))
