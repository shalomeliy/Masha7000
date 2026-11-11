// The voice assistant, app side: the snapshot of the lists sent with each turn, and checking and
// applying a proposal the manager confirmed. Pure, so it is tested without Drive or the server.
// The server (api/_lib/assistant.ts) only proposes; every change is made here, by the same rules
// the screens use.

import { certStars, endsNextDay, fullName, isActive, MAX_STAFF, MAX_STARS, nameError, newId, placeText, staffingFor, upsert } from './catalog'
import { ABSENCE_NAMES, blockingConstraints, constraintText, isOver, shiftDays } from './constraints'
import { todayIso } from './dates'
import { autoAssign, busyCrew, busyText, pullFrom } from './planner'
import { addDays, dayName, hebrewDayName, isNightShift, isWaiting, showDate } from './shifts'
import { toggleKind } from './workKinds'
import { applyEdits, editCount, type Edits } from './assistantEdits'
import { kindOf, workerState } from './workerState'
import type {
  AssistantExample,
  AssistantNote,
  Certification,
  Constraint,
  Department,
  JobType,
  PendingJob,
  Place,
  PostponeReason,
  ShiftDefinition,
  ShiftRecord,
  StaffSlot,
  WorkKind,
  Worker,
} from '../types/models'
import { tx } from '../i18n'
import { asTaskList, oneLine } from './taskList'

export interface AppData {
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

export type ListName = 'places' | 'jobTypes' | 'certifications' | 'postponeReasons'
export type Screen = 'calendar' | 'toSchedule' | 'workers' | 'archive' | 'settings'

export interface ProposedJob {
  date: string // '' = to the waiting list
  shiftKindId: string
  location: string
  jobDescription: string
  staffing: { count: number; certificationIds: string[] }[]
  workKindIds: string[]
  note: string
  autoAssign: boolean
  nextJob: { location: string; jobDescription: string } // "לינה" only: the job after the night; empty otherwise
  crew: { workerId: string }[] // workers the manager named for the new job; [] = none named
}

export interface Proposal extends Edits {
  summary: string
  jobs: ProposedJob[]
  assignShiftIds: string[]
  workers: { firstName: string; lastName: string; mobilePhone: string; certificationIds: string[] }[]
  listItems: { list: ListName; name: string }[]
  rememberNotes: string[] // things the manager asked the assistant to remember from now on
  lessons: string[] // rules the assistant learned from the manager in this conversation; saved with the yes
  forgetNoteIds: string[]
  // The manager's answer when a worker comes back in the middle of an absence: for this job only
  // (the rest stays), or the absence is cancelled from now on. Set by the app, never by the model.
  absenceReturn?: 'job' | 'all'
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
    staffingFor(staffing, certIds).map((s) => placeText(s, d.certifications))
  const pastFrom = addDays(today, -HISTORY_DAYS)
  const past = d.shifts.filter((s) => s.date >= pastFrom && s.date <= today && s.crew.length)
  const where = (s: ShiftRecord) => s.location.trim() || s.jobDescription.trim()
  const open = (w: Worker) => w.constraints.filter((c) => !isOver(c, today))
  return {
    today: `${today} (יום ${hebrewDayName(today)})`,
    days: Array.from({ length: CALENDAR_DAYS }, (_, i) => {
      const date = addDays(today, i)
      return `${date} = ${i === 0 ? 'היום, ' : i === 1 ? 'מחר, ' : ''}יום ${hebrewDayName(date)} ${showDate(date)}`
    }),
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
      // The manager's stars (1-5) in each certification; "טיפוס (3/5)" only when below the full 5.
      certifications: w.certificationIds
        .filter((id) => name(id, d.certifications))
        .map((id) => (certStars(w, id) < MAX_STARS ? `${name(id, d.certifications)} (${certStars(w, id)}/${MAX_STARS})` : name(id, d.certifications))),
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
        date: `${s.date} (יום ${hebrewDayName(s.date)})`,
        kind: s.urgent ? 'דחופה' : name(s.shiftDefinitionId ?? '', d.shiftDefinitions),
        location: s.location,
        job: s.jobDescription,
        needs: staffingNames(s.staffing),
        crew: s.crew.map((c) => workerName(c.workerId)),
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
    // A job with no date may be left without a kind too ("לא יודע אם יום או לילה"): it waits in לשיבוץ.
    if (j.shiftKindId && !has(d.shiftDefinitions, j.shiftKindId)) errors.push(`${n}: אין תבנית עבודה עם id "${j.shiftKindId}"`)
    if (!j.shiftKindId && j.date) errors.push(`${n}: עבודה עם תאריך צריכה תבנית (shiftKindId); בלי תבנית רק עבודה לשיבוץ, בלי תאריך`)
    if (!j.location.trim() && !j.jobDescription.trim()) errors.push(`${n}: חסרים מקום ומהות עבודה`)
    for (const s of j.staffing) {
      if (!(s.count >= 1)) errors.push(`${n}: מספר אנשים לא תקין`)
      for (const c of s.certificationIds) if (!has(d.certifications, c)) errors.push(`${n}: אין הסמכה עם id "${c}"`)
    }
    for (const k of j.workKindIds) if (!has(d.workKinds, k)) errors.push(`${n}: אין סוג עבודה עם id "${k}"`)
    if (j.autoAssign && !j.date) errors.push(`${n}: אפשר לשבץ עובדים רק לעבודה עם תאריך`)
    if (j.crew.length && !j.date) errors.push(`${n}: אפשר לשים עובדים רק בעבודה עם תאריך`)
    for (const m of j.crew) {
      const w = d.workers.find((x) => x.id === m.workerId)
      if (!w) errors.push(`${n}: אין עובד עם id "${m.workerId}"`)
    }
  })
  for (const id of p.forgetNoteIds) if (!has(d.assistantNotes, id)) errors.push(`אין הערה שמורה עם id "${id}"`)
  for (const id of p.assignShiftIds) if (!has(d.shifts, id)) errors.push(`אין עבודה ביומן עם id "${id}"`)
  p.workers.forEach((w, i) => {
    if (!w.firstName.trim()) errors.push(`עובד ${i + 1}: חסר שם פרטי`)
    for (const c of w.certificationIds) if (!has(d.certifications, c)) errors.push(`עובד ${i + 1}: אין הסמכה עם id "${c}"`)
  })
  for (const item of p.listItems) {
    const e = nameError(item.name, d[item.list])
    if (e) errors.push(`"${item.name}": ${e}`)
  }
  const total = p.jobs.length + p.assignShiftIds.length + p.workers.length + p.listItems.length + p.rememberNotes.length + p.forgetNoteIds.length + editCount(p)
  // Edits are tried on a copy: what the screens would refuse (a worker in two jobs, a missing certification) goes back.
  errors.push(...applyProposal(p, d).errors)
  if (total === 0) errors.push('אין בהצעה שום שינוי')
  return errors
}

/** The job's places: one per person, then the places of its work kinds. Never more than MAX_STAFF. */
export function jobStaffing(j: ProposedJob, d: AppData): { staffing: StaffSlot[]; workKindIds: string[] } {
  let job: { staffing: StaffSlot[]; workKindIds: string[] } = {
    staffing: j.staffing.flatMap((s) =>
      Array.from({ length: Math.max(1, Math.round(s.count)) }, () => (s.certificationIds.length ? { certificationIds: s.certificationIds } : {})),
    ),
    workKindIds: [],
  }
  for (const id of j.workKindIds) {
    const kind = d.workKinds.find((k) => k.id === id)
    if (kind) job = toggleKind(job, kind)
  }
  if (!job.staffing.length) job.staffing = [{}]
  return { staffing: job.staffing.slice(0, MAX_STAFF), workKindIds: job.workKindIds }
}

export interface Applied {
  data: AppData
  changed: Set<keyof AppData>
  report: string[] // Hebrew, spoken after saving: what was done and what could not be
  errors: string[] // what the app refuses (sent back to the model): see proposalErrors
  // Workers the proposal puts in a job while they are in another one at the same time. Applying
  // moves them (the other job is left with an empty place); the manager hears this before the yes.
  conflicts: string[]
  // A worker comes back in the middle of an absence that goes on after the job: the manager is asked
  // whether only for this job or the absence is cancelled (RETURN_ASK), before the yes.
  asksReturn: boolean
}

/** The data after the confirmed proposal; the caller saves each list in `changed`. */
export function applyProposal(p: Proposal, before: AppData, now = new Date()): Applied {
  const d: AppData = { ...before }
  const changed = new Set<keyof AppData>()
  const report: string[] = []
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
    if (remember.length) report.push(remember.length === 1 ? tx('רשמתי לעצמי לזכור את זה') : tx('רשמתי לעצמי {length} דברים לזכור', { length: remember.length }))
    if (p.forgetNoteIds.length) report.push(p.forgetNoteIds.length === 1 ? tx('מחקתי את זה מהזיכרון') : tx('מחקתי {length} דברים מהזיכרון', { length: p.forgetNoteIds.length }))
  }

  for (const item of p.listItems) {
    const list = d[item.list] as { id: string; name: string }[]
    d[item.list] = [...list, { id: newId(), name: item.name.trim() }] as never
    changed.add(item.list)
  }
  if (p.listItems.length) report.push(p.listItems.length === 1 ? tx('הוספתי פריט לרשימה') : tx('הוספתי {length} פריטים לרשימות', { length: p.listItems.length }))

  for (const w of p.workers) {
    d.workers = [
      ...d.workers,
      {
        id: newId(),
        firstName: w.firstName.trim(),
        lastName: w.lastName.trim(),
        mobilePhone: w.mobilePhone.replace(/[^\d+]/g, '') || undefined,
        certificationIds: w.certificationIds,
        constraints: [],
      },
    ]
    changed.add('workers')
  }
  if (p.workers.length) report.push(p.workers.length === 1 ? tx('הוספתי את {v} לעובדים', { v: p.workers[0].firstName }) : tx('הוספתי {length} עובדים', { length: p.workers.length }))

  const toAssign = [...p.assignShiftIds]
  const crewed: string[] = [] // new jobs with workers named by the manager
  let calendar = 0
  let waiting = 0
  for (const j of p.jobs) {
    const { staffing, workKindIds } = jobStaffing(j, d)
    const base = {
      id: newId(),
      location: j.location.trim(),
      jobDescription: asTaskList(j.jobDescription),
      staffing,
      ...(j.shiftKindId ? { shiftDefinitionId: j.shiftKindId } : {}),
      ...(workKindIds.length ? { workKindIds } : {}),
    }
    const kind = d.shiftDefinitions.find((s) => s.id === j.shiftKindId)
    const next = { location: j.nextJob.location.trim(), jobDescription: asTaskList(j.nextJob.jobDescription) }
    const hasNext = Boolean(kind?.thenJob && (next.location || next.jobDescription))
    if (j.date) {
      // Workers the manager named must be in the job: "שבץ" fills the rest around them.
      d.shifts = [...d.shifts, { ...base, date: j.date, crew: j.crew, ...(j.crew.length ? { pinnedIds: j.crew.map((c) => c.workerId) } : {}), ...(hasNext ? { nextJob: next } : {}) }]
      changed.add('shifts')
      calendar++
      if (j.autoAssign) toAssign.push(base.id)
      if (j.crew.length) crewed.push(base.id)
    } else {
      // A waiting job has no field for the job after the night: it goes into the note.
      const note = [j.note.trim(), hasNext ? tx('אחרי הלינה: {v}', { v: [next.location, oneLine(next.jobDescription)].filter(Boolean).join(' - ') }) : ''].filter(Boolean).join('. ')
      d.pendingJobs = [...d.pendingJobs, { ...base, reasonIds: [], createdAt: at, ...(note ? { note } : {}) }]
      changed.add('pendingJobs')
      waiting++
    }
  }
  if (calendar) report.push(calendar === 1 ? tx('הוספתי עבודה ליומן') : tx('הוספתי {calendar} עבודות ליומן', { calendar }))
  if (waiting) report.push(waiting === 1 ? tx('הוספתי עבודה לרשימת הממתינות') : tx('הוספתי {waiting} עבודות לרשימת הממתינות', { waiting }))

  const edits = applyEdits(p, d, at, changed)
  report.push(...edits.report)
  toAssign.push(...edits.toAssign)

  // Nobody in two jobs at the same time, from anywhere. A clash with a job this proposal does not
  // touch is a move the manager must confirm (said before the yes, done on it); a clash inside the
  // proposal, or with a closed job, is refused.
  const errors = [...edits.errors]
  const conflicts: string[] = []
  const placed = [...new Set([...crewed, ...edits.touched])]
  for (const id of placed) {
    const shift = d.shifts.find((s) => s.id === id)
    if (!shift) continue
    const busy = busyCrew(shift, d.workers, d.shifts, d.shiftDefinitions)
    const refused = busy.filter((b) => placed.includes(b.other.id) || b.other.closure)
    if (refused.length) errors.push(busyText(refused)!)
    const moves = busy.filter((b) => !refused.includes(b))
    if (!moves.length) continue
    d.shifts = pullFrom(shift, moves.map((b) => b.worker.id), d.shifts, d.shiftDefinitions, {}, at)
    changed.add('shifts')
    for (const { worker, other } of moves) {
      const from = tx('{v} (יום {weekday} {v3})', { v: other.location || oneLine(other.jobDescription), weekday: dayName(other.date), v3: showDate(other.date) })
      const into = shift.location || oneLine(shift.jobDescription)
      conflicts.push(tx('{firstName} כבר משובץ באותו זמן ב{from}. אם תאשר, אעביר אותו ל{into}, ושם יישאר מקום ריק', { firstName: worker.firstName, from, into }))
      report.push(tx('העברתי את {firstName} מ{v} ל{into}', { firstName: worker.firstName, v: other.location || oneLine(other.jobDescription), into }))
    }
  }

  // A worker the manager put in a job (or who moved with it) while sick or away on its days: the
  // manager is asked whether that is over (the user's rule, 2026-11-11). The yes places him and
  // updates his state: sickness saved as the status ends. A dated absence with days still to come
  // around the job asks first: back only for this job (those days are cut out, the rest stays), or
  // the absence is cancelled from now on. A weekly or part-of-day constraint is only said.
  const today = at.slice(0, 10)
  let asksReturn = false
  for (const id of placed) {
    const shift = d.shifts.find((s) => s.id === id)
    if (!shift) continue
    // Every reason he is out on those days, not only the first: a vacation and a plain "לא זמין"
    // over the same days are both asked about and both updated (a bug the user found, 2026-11-11).
    for (const m of shift.crew) for (const c of blockingConstraints(d.workers.find((w) => w.id === m.workerId) ?? { constraints: [] }, shift, d.shiftDefinitions)) {
      const worker = d.workers.find((w) => w.id === m.workerId)!
      const kind = c.id === 'sick' ? 'sick' : kindOf(c)
      const what = constraintText(c)
      if (c.id !== 'sick' && (c.when !== 'dates' || c.part || c.nightsOnly)) {
        report.push(tx('שים לב, {firstName}: {v}.', { firstName: worker.firstName, v: what }))
        continue
      }
      const days = shiftDays(shift, d.shiftDefinitions)
      const cut = c.id === 'sick' ? [] : cutAround([c], c, days[0], days.at(-1)!)
      const ask = cut.some((x) => (x.to ?? x.from!) >= today)
      let constraints = worker.constraints
      if (c.id !== 'sick') {
        const from = days[0] < today ? days[0] : today
        constraints = !ask || p.absenceReturn !== 'all' ? cutAround(constraints, c, days[0], days.at(-1)!) : constraints.flatMap((x) => (x.id !== c.id ? [x] : c.from! < from ? [{ ...c, to: addDays(from, -1) }] : []))
      }
      d.workers = upsert(d.workers, c.id === 'sick' ? { ...worker, status: 'active', sickUntil: undefined } : { ...worker, constraints })
      changed.add('workers')
      if (ask) {
        asksReturn = true
        conflicts.push(tx('{firstName} רשום {v}', { firstName: worker.firstName, v: what }))
        report.push(
          p.absenceReturn === 'all'
            ? kind ? tx('עדכנתי ש{firstName} כבר לא {state}', { firstName: worker.firstName, state: ABSENCE_NAMES[kind] }) : tx('עדכנתי ש{firstName} זמין', { firstName: worker.firstName })
            : tx('עדכנתי ש{firstName} זמין רק לעבודה הזו', { firstName: worker.firstName }),
        )
      } else if (kind) {
        conflicts.push(tx('{firstName} רשום {v}. הוא כבר לא {state}? אם תאשר, אשבץ אותו ואעדכן את הסטטוס שלו', { firstName: worker.firstName, v: what, state: ABSENCE_NAMES[kind] }))
        report.push(tx('עדכנתי ש{firstName} כבר לא {state}', { firstName: worker.firstName, state: ABSENCE_NAMES[kind] }))
      } else {
        conflicts.push(tx('{firstName} רשום {v}. הוא כבר זמין? אם תאשר, אשבץ אותו ואעדכן את הסטטוס שלו', { firstName: worker.firstName, v: what }))
        report.push(tx('עדכנתי ש{firstName} זמין', { firstName: worker.firstName }))
      }
    }
  }

  for (const id of toAssign) {
    const shift = d.shifts.find((s) => s.id === id)
    if (!shift) continue
    const staffing = staffingFor(shift.staffing, d.certifications.map((c) => c.id))
    const plan = autoAssign(shift, staffing, { workers: d.workers, records: d.shifts, defs: d.shiftDefinitions })
    d.shifts = upsert(d.shifts, { ...shift, crew: plan.crew })
    changed.add('shifts')
    const where = shift.location || oneLine(shift.jobDescription)
    const names = plan.crew.map((c) => d.workers.find((w) => w.id === c.workerId)).filter((w): w is Worker => Boolean(w)).map((w) => w.firstName)
    report.push(names.length ? tx('ב{where} שיבצתי את {v}', { where, v: names.join(', ') }) : tx('ב{where} לא מצאתי עובדים מתאימים', { where }))
    if (plan.unfilled.length && names.length) report.push(tx('ב{where} נשארו {v}', { where, v: plan.unfilled.length === 1 ? tx('מקום אחד פנוי') : tx('{length} מקומות פנויים', { length: plan.unfilled.length }) }))
  }
  report.push(...edits.warnings)
  return { data: d, changed, report, errors, conflicts, asksReturn }
}

/** A dated absence without the days from `first` to `last`: what was before and after them stays. */
function cutAround(list: Constraint[], c: Constraint, first: string, last: string): Constraint[] {
  const from = c.from!
  const to = c.to ?? from
  const parts: Constraint[] = []
  if (from < first) parts.push({ ...c, to: addDays(first, -1) })
  if (to > last) parts.push({ ...c, id: parts.length ? newId() : c.id, from: addDays(last, 1), to })
  return list.flatMap((x) => (x.id === c.id ? parts : [x]))
}

/** The question when a worker comes back in the middle of an absence (asksReturn). */
export const returnAsk = () => tx('הוא חוזר רק לעבודה הזו, או שזה בוטל לגמרי?')

/** The answer to returnAsk, said in Hebrew: "רק לעבודה הזו" or "בוטל לגמרי"; null when it is neither. */
export function returnChoice(said: string): 'job' | 'all' | null {
  if (/בוטל|בוטלה|לגמרי|נגמר|נגמרה|כל ה/.test(said)) return 'all'
  if (/רק|הזו|הזאת|היום|לעבודה/.test(said)) return 'job'
  return null
}

/** The moves of busy workers the manager has to hear before saying yes (empty: none). */
export const proposalConflicts = (p: Proposal, d: AppData) => applyProposal(p, d).conflicts

/**
 * What the proposal removes, worded here from the proposal itself and not by the model (code scan
 * 2026-11-10): the manager hears every deletion before the yes, even when the model's summary left it out.
 */
export function proposalDangers(p: Proposal, d: AppData): string[] {
  const out: string[] = []
  for (const id of p.deleteJobIds) {
    const shift = d.shifts.find((s) => s.id === id)
    const job = d.pendingJobs.find((j) => j.id === id)
    if (shift) out.push(tx('זה ימחק את העבודה ב{where} (יום {weekday} {date})', { where: shift.location || oneLine(shift.jobDescription), weekday: dayName(shift.date), date: showDate(shift.date) }))
    else if (job) out.push(tx('זה ימחק את העבודה הממתינה ב{where}', { where: job.location || oneLine(job.jobDescription) }))
  }
  for (const e of p.editWorkers) {
    const w = d.workers.find((x) => x.id === e.workerId)
    if (!w) continue
    if (e.status === 'inactive') out.push(tx('{name} יסומן כלא פעיל', { name: fullName(w) }))
    for (const cid of e.removeCertificationIds) {
      const cert = d.certifications.find((c) => c.id === cid)
      if (cert && w.certificationIds.includes(cid)) out.push(tx('זה יוריד ל{name} את ההסמכה {cert}', { name: fullName(w), cert: cert.name }))
    }
  }
  return out
}

/** The spoken proposal: the model's summary, with any move of a busy worker said before the question. */
export function summaryWithConflicts(summary: string, conflicts: string[]): string {
  if (!conflicts.length) return summary
  const ask = tx('לאשר, או שיש עוד תיקון?')
  const body = summary.replace(ask, '').trim().replace(/[.,]$/, '')
  return tx('{body}. שים לב: {v}. לאשר, או שיש עוד תיקון?', { body, v: conflicts.join('. ') })
}

// "כן", "מאשר", "תאשר", "בצע", "סגור" and the like, said alone, after a proposal.
const YES = /^(כן|כן כן|מאשר|אשר|תאשר|אישור|מאושר|בצע|תבצע|סגור|יאללה|אוקיי|אוקי|בסדר|נכון|יופי|סבבה|כן לאשר|כן תאשר|כן מאשר|לאשר)$/
// The same in the other languages of the app (src/i18n/languages.ts).
const YES_OTHER = /^(yes|yeah|yep|ok|okay|sure|confirm|approve|go ahead|do it|نعم|أجل|موافق|تمام|أكيد|да|давай|подтверждаю|хорошо|ок|sí|si|vale|confirmo|claro|oui|d'accord|je confirme|ja|jawohl|bestätigen|sim|confirmo|pode|是|是的|好|好的|确认|对|हाँ|हां|ठीक है|জি|হ্যাঁ|ঠিক আছে|جی|ہاں|ٹھیک ہے|ya|oke|setuju|はい|お願いします|evet|tamam|onaylıyorum)$/i
export const isYes = (said: string) => {
  const s = said.trim().replace(/[.,!?。！、،]/g, '').replace(/\s+/g, ' ')
  return YES.test(s) || YES_OTHER.test(s)
}

// The proposal tool is not strict (its full grammar is over the API's limit), so a field may be
// missing or of the wrong kind. Everything the app reads is given its empty value here.
const S = (v: unknown) => (typeof v === 'string' ? v : '')
const B = (v: unknown) => v === true
const SS = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const A = <T>(v: unknown, f: (o: Record<string, unknown>) => T): T[] =>
  Array.isArray(v) ? v.filter((o): o is Record<string, unknown> => !!o && typeof o === 'object').map(f) : []
const lines = (v: unknown) => A(v, (s) => ({ count: Number(s.count) || 1, certificationIds: SS(s.certificationIds) }))
const LISTS: ListName[] = ['places', 'jobTypes', 'certifications', 'postponeReasons']
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
        crew: A(j.crew, (m) => ({ workerId: S(m.workerId) })).filter((m, k, list) => m.workerId && list.findIndex((x) => x.workerId === m.workerId) === k),
      }
    }),
    assignShiftIds: SS(p.assignShiftIds),
    workers: A(p.workers, (w) => ({ firstName: S(w.firstName), lastName: S(w.lastName), mobilePhone: S(w.mobilePhone), certificationIds: SS(w.certificationIds) })),
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
    setCrews: A(p.setCrews, (c) => ({ shiftId: S(c.shiftId), crew: A(c.crew, (m) => ({ workerId: S(m.workerId) })) })),
    closeJobs: A(p.closeJobs, (c) => ({ shiftId: S(c.shiftId), outcome: (OUTCOMES as readonly string[]).includes(S(c.outcome)) ? (c.outcome as (typeof OUTCOMES)[number]) : 'done', note: S(c.note) })),
    deleteJobIds: SS(p.deleteJobIds),
    editWorkers: A(p.editWorkers, (w) => ({
      workerId: S(w.workerId),
      mobilePhone: S(w.mobilePhone),
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
      kind: (['vacation', 'study', 'reserve', 'course', 'sick'] as const).find((k) => k === c.kind) ?? '',
    })),
  }
}
