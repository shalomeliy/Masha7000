// The voice assistant, app side: the snapshot of the lists sent with each turn, and checking and
// applying a proposal the manager confirmed. Pure, so it is tested without Drive or the server.
// The server (api/_lib/assistant.ts) only proposes; every change is made here, by the same rules
// the screens use.

import { endsNextDay, fullName, generalRoleId, isActive, MAX_STAFF, nameError, newId, staffingFor, upsert } from './catalog'
import { constraintText, isOver } from './constraints'
import { todayIso } from './dates'
import { autoAssign } from './planner'
import { addDays, dayName, isNightShift, isWaiting, showDate } from './shifts'
import { toggleKind } from './workKinds'
import { applyEdits, editCount, type Edits } from './assistantEdits'
import { workerState } from './workerState'
import type {
  AssistantExample,
  AssistantNote,
  Certification,
  Department,
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
  assistantNotes: AssistantNote[]
  departments: Department[]
  assistantExamples: AssistantExample[]
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
  nextJob: { location: string; jobDescription: string } // "לינה" only: the job after the night; empty otherwise
}

export interface Proposal extends Edits {
  summary: string
  jobs: ProposedJob[]
  assignShiftIds: string[]
  workers: { firstName: string; lastName: string; mobilePhone: string; roleIds: string[]; certificationIds: string[] }[]
  listItems: { list: ListName; name: string }[]
  rememberNotes: string[] // things the manager asked the assistant to remember from now on
  lessons: string[] // rules the assistant learned from the manager in this conversation; saved with the yes
  forgetNoteIds: string[]
}

// Shifts this far back and ahead go to the assistant; enough for "מי עבד אתמול" and the coming weeks.
const PAST_DAYS = 7
const AHEAD_DAYS = 28
// The habits of the team ("who usually goes to Eilat") come from this many days back, as counts.
const HISTORY_DAYS = 56
// Days listed by name and date, so "ראשון הקרוב" or "שלישי הבא" is looked up, not computed.
const CALENDAR_DAYS = 21

/** The most frequent values, most first, at most `n`. */
function top(values: string[], n = 3): string[] {
  const counts = new Map<string, number>()
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'he')).slice(0, n).map(([v, c]) => (c > 1 ? `${v} (${c})` : v))
}

/** What each kind of job means, in the words the manager uses, so "כולל לינה" is never a name. */
function kindMeaning(s: ShiftDefinition): string {
  if (s.thenJob) return 'עבודת לילה ואחריה עוד עבודה לפני החזרה לבסיס. נגמרת ב-16:00 למחרת. נקראת גם "כולל לינה", "עם לינה", "לילה פלוס"'
  if (endsNextDay(s)) return 'יוצאים בבוקר, עובדים גם בלילה, חוזרים ב-16:00 למחרת'
  if (s.isStandby) return 'כוננות'
  return `עבודת יום, ${s.startTime} עד ${s.endTime} באותו יום`
}

const named = (items: { id: string; name: string }[]) => items.map(({ id, name }) => ({ id, name }))

/** What the assistant knows: the lists, active workers, near shifts and waiting jobs. Ids for ids only. */
// Past confirmed requests sent with each turn: the ones sharing the most words with what was just
// said, newest first on a tie. Few, to keep every turn cheap.
const EXAMPLES = 6
export const MAX_EXAMPLES = 200
const words = (t: string) => new Set(t.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1))

export function relevantExamples(all: AssistantExample[], said: string, n = EXAMPLES): AssistantExample[] {
  const mine = words(said)
  const score = (e: AssistantExample) => [...words(e.said)].filter((w) => mine.has(w)).length
  return all
    .map((e, i) => ({ e, s: score(e), i }))
    .sort((a, b) => b.s - a.s || b.i - a.i)
    .slice(0, n)
    .map((x) => x.e)
}

export function snapshot(d: AppData, now = new Date(), said = '') {
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
  const pastFrom = addDays(today, -HISTORY_DAYS)
  const past = d.shifts.filter((s) => s.date >= pastFrom && s.date <= today && s.crew.length)
  const where = (s: ShiftRecord) => s.location.trim() || s.jobDescription.trim()
  const open = (w: Worker) => w.constraints.filter((c) => !isOver(c, today))
  return {
    today: `${today} (יום ${dayName(today)})`,
    days: Array.from({ length: CALENDAR_DAYS }, (_, i) => {
      const date = addDays(today, i)
      return `${date} = ${i === 0 ? 'היום, ' : i === 1 ? 'מחר, ' : ''}יום ${dayName(date)} ${showDate(date)}`
    }),
    roles: named(d.roles),
    certifications: named(d.certifications),
    shiftKinds: d.shiftDefinitions.map((s) => ({ id: s.id, name: s.name, night: endsNextDay(s), meaning: kindMeaning(s), ...(s.thenJob ? { hasNextJob: true } : {}) })),
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
      ...(w.departmentId && name(w.departmentId, d.departments) ? { department: name(w.departmentId, d.departments) } : {}),
      ...(w.status === 'sick' ? { sickUntil: w.sickUntil ?? '' } : {}),
      ...(workerState(w, today).id !== 'fit' ? { now: workerState(w, today).label } : {}),
      ...(open(w).length ? { cannot: open(w).map(constraintText) } : {}),
      ...(w.notes?.trim() ? { notes: w.notes.trim().slice(0, 200) } : {}),
    })),
    // The last 8 weeks, counted: who did how many jobs and nights, where, and with whom.
    history: {
      fromDate: pastFrom,
      workers: d.workers.filter(isActive).flatMap((w) => {
        const mine = past.filter((s) => s.crew.some((c) => c.workerId === w.id))
        if (!mine.length) return []
        return [
          {
            name: fullName(w),
            jobs: mine.length,
            nights: mine.filter((s) => isNightShift(s, d.shiftDefinitions)).length,
            last: mine.map((s) => s.date).sort().at(-1),
            places: top(mine.map(where)),
            with: top(mine.flatMap((s) => s.crew.filter((c) => c.workerId !== w.id).map((c) => workerName(c.workerId)))),
          },
        ]
      }),
      places: [...new Set(past.map(where))].filter(Boolean).map((place) => {
        const here = past.filter((s) => where(s) === place)
        return {
          place,
          jobs: here.length,
          last: here.map((s) => s.date).sort().at(-1),
          work: top(here.map((s) => s.jobDescription.trim()), 2),
          crew: top(here.flatMap((s) => s.crew.map((c) => workerName(c.workerId)))),
        }
      }),
    },
    remembered: d.assistantNotes.map((n) => ({ id: n.id, text: n.text })),
    examples: relevantExamples(d.assistantExamples, said).map((e) => ({ said: e.said, did: e.did })),
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
        ...(s.nextJob ? { then: [s.nextJob.location, s.nextJob.jobDescription].filter(Boolean).join(' - ') } : {}),
        ...(s.closure ? { closed: s.closure.outcome } : {}),
      })),
    waitingJobs: d.pendingJobs
      .filter((j) => isWaiting(j, d.shifts))
      .map((j) => ({ id: j.id, location: j.location, job: j.jobDescription, kind: name(j.shiftDefinitionId ?? '', d.shiftDefinitions), needs: staffingNames(j.staffing) })),
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
  for (const id of p.forgetNoteIds) if (!has(d.assistantNotes, id)) errors.push(`אין הערה שמורה עם id "${id}"`)
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
  const total = p.jobs.length + p.assignShiftIds.length + p.workers.length + p.listItems.length + p.rememberNotes.length + p.forgetNoteIds.length + editCount(p)
  // Edits are tried on a copy: what the screens would refuse (a worker in two jobs, a missing role) goes back.
  errors.push(...applyEdits(p, { ...d }, new Date().toISOString(), new Set()).errors)
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

  const remember = p.rememberNotes.map((t) => t.trim()).filter(Boolean)
  const known = new Set([...d.assistantNotes.map((n) => n.text), ...remember])
  const lessons = [...new Set(p.lessons.map((t) => t.trim()).filter((t) => t && !known.has(t)))]
  if (lessons.length) {
    d.assistantNotes = [...d.assistantNotes, ...lessons.map((text) => ({ id: newId(), text, createdAt: at, learned: true as const }))]
    changed.add('assistantNotes')
  }
  if (remember.length || p.forgetNoteIds.length) {
    d.assistantNotes = [...d.assistantNotes.filter((n) => !p.forgetNoteIds.includes(n.id)), ...remember.map((text) => ({ id: newId(), text, createdAt: at }))]
    changed.add('assistantNotes')
    if (remember.length) report.push(remember.length === 1 ? 'רשמתי לעצמי לזכור את זה' : `רשמתי לעצמי ${remember.length} דברים לזכור`)
    if (p.forgetNoteIds.length) report.push(p.forgetNoteIds.length === 1 ? 'מחקתי את זה מהזיכרון' : `מחקתי ${p.forgetNoteIds.length} דברים מהזיכרון`)
  }

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
    const kind = d.shiftDefinitions.find((s) => s.id === j.shiftKindId)
    const next = { location: j.nextJob.location.trim(), jobDescription: j.nextJob.jobDescription.trim() }
    const hasNext = Boolean(kind?.thenJob && (next.location || next.jobDescription))
    if (j.date) {
      d.shifts = [...d.shifts, { ...base, date: j.date, crew: [], ...(hasNext ? { nextJob: next } : {}) }]
      changed.add('shifts')
      calendar++
      if (j.autoAssign) toAssign.push(base.id)
    } else {
      // A waiting job has no field for the job after the night: it goes into the note.
      const note = [j.note.trim(), hasNext ? `אחרי הלינה: ${[next.location, next.jobDescription].filter(Boolean).join(' - ')}` : ''].filter(Boolean).join('. ')
      d.pendingJobs = [...d.pendingJobs, { ...base, reasonIds: [], createdAt: at, ...(note ? { note } : {}) }]
      changed.add('pendingJobs')
      waiting++
    }
  }
  if (calendar) report.push(calendar === 1 ? 'הוספתי עבודה ליומן' : `הוספתי ${calendar} עבודות ליומן`)
  if (waiting) report.push(waiting === 1 ? 'הוספתי עבודה לרשימת הממתינות' : `הוספתי ${waiting} עבודות לרשימת הממתינות`)

  const edits = applyEdits(p, d, at, changed)
  report.push(...edits.report)
  toAssign.push(...edits.toAssign)

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
  report.push(...edits.warnings)
  return { data: d, changed, report }
}

// "כן", "מאשר", "תאשר", "בצע", "סגור" and the like, said alone, after a proposal.
const YES = /^(כן|כן כן|מאשר|אשר|תאשר|אישור|מאושר|בצע|תבצע|סגור|יאללה|אוקיי|אוקי|בסדר|נכון|יופי|סבבה|כן לאשר|כן תאשר|כן מאשר|לאשר)$/
export const isYes = (said: string) => YES.test(said.trim().replace(/[.,!?]/g, '').replace(/\s+/g, ' '))

// The proposal tool is not strict (its full grammar is over the API's limit), so a field may be
// missing or of the wrong kind. Everything the app reads is given its empty value here.
const S = (v: unknown) => (typeof v === 'string' ? v : '')
const B = (v: unknown) => v === true
const SS = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const A = <T>(v: unknown, f: (o: Record<string, unknown>) => T): T[] =>
  Array.isArray(v) ? v.filter((o): o is Record<string, unknown> => !!o && typeof o === 'object').map(f) : []
const lines = (v: unknown) => A(v, (s) => ({ roleId: S(s.roleId), count: Number(s.count) || 1, certificationIds: SS(s.certificationIds) }))
const LISTS: ListName[] = ['places', 'jobTypes', 'roles', 'certifications', 'postponeReasons']
const OUTCOMES = ['done', 'partial', 'postponed'] as const
const STATUSES = ['', 'active', 'sick', 'inactive'] as const

export function normalizeProposal(raw: unknown): Proposal {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    summary: S(p.summary),
    jobs: A(p.jobs, (j) => {
      const next = (j.nextJob && typeof j.nextJob === 'object' ? j.nextJob : {}) as Record<string, unknown>
      return {
        date: S(j.date),
        shiftKindId: S(j.shiftKindId),
        location: S(j.location),
        jobDescription: S(j.jobDescription),
        staffing: lines(j.staffing),
        workKindIds: SS(j.workKindIds),
        note: S(j.note),
        autoAssign: B(j.autoAssign),
        nextJob: { location: S(next.location), jobDescription: S(next.jobDescription) },
      }
    }),
    assignShiftIds: SS(p.assignShiftIds),
    workers: A(p.workers, (w) => ({ firstName: S(w.firstName), lastName: S(w.lastName), mobilePhone: S(w.mobilePhone), roleIds: SS(w.roleIds), certificationIds: SS(w.certificationIds) })),
    listItems: A(p.listItems, (i) => ({ list: i.list as ListName, name: S(i.name) })).filter((i) => LISTS.includes(i.list)),
    rememberNotes: SS(p.rememberNotes),
    lessons: SS(p.lessons),
    forgetNoteIds: SS(p.forgetNoteIds),
    editJobs: A(p.editJobs, (j) => ({
      id: S(j.id),
      date: S(j.date),
      shiftKindId: S(j.shiftKindId),
      location: S(j.location),
      jobDescription: S(j.jobDescription),
      staffing: lines(j.staffing),
      autoAssign: B(j.autoAssign),
    })),
    setCrews: A(p.setCrews, (c) => ({ shiftId: S(c.shiftId), crew: A(c.crew, (m) => ({ workerId: S(m.workerId), roleId: S(m.roleId) })) })),
    closeJobs: A(p.closeJobs, (c) => ({ shiftId: S(c.shiftId), outcome: (OUTCOMES as readonly string[]).includes(S(c.outcome)) ? (c.outcome as (typeof OUTCOMES)[number]) : 'done', note: S(c.note) })),
    deleteJobIds: SS(p.deleteJobIds),
    editWorkers: A(p.editWorkers, (w) => ({
      workerId: S(w.workerId),
      mobilePhone: S(w.mobilePhone),
      addRoleIds: SS(w.addRoleIds),
      removeRoleIds: SS(w.removeRoleIds),
      addCertificationIds: SS(w.addCertificationIds),
      removeCertificationIds: SS(w.removeCertificationIds),
      status: (STATUSES as readonly string[]).includes(S(w.status)) ? (S(w.status) as (typeof STATUSES)[number]) : '',
      sickUntil: S(w.sickUntil),
    })),
    addConstraints: A(p.addConstraints, (c) => ({
      workerId: S(c.workerId),
      from: S(c.from),
      to: S(c.to),
      nightsOnly: B(c.nightsOnly),
      note: S(c.note),
      kind: (['vacation', 'study', 'reserve', 'course'] as const).find((k) => k === c.kind) ?? '',
    })),
  }
}
