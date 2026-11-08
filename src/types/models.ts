// Data schemas from docs/input/02-technical-spec.md, section 3.

export interface Role {
  id: string
  name: string // e.g. "טפסן", "חשמלאי"
}

// Not in the spec: a separate list from roles, e.g. "אנטנה עד גובה 20 מטר", "חשמלאי מוסמך".
export interface Certification {
  id: string
  name: string
}

export type DayPart = 'morning' | 'noon' | 'evening'

// When a worker cannot work. `when` says which days: a date range (vacation, a day off), fixed
// weekdays every week, or always. `nightsOnly` narrows it to night jobs starting on those days.
// The spec's single-date `{ date, reason }` is upgraded on read (`normalizeConstraint`).
// Why a worker is away for a stretch of days; shown as the worker's state on the card.
export type AbsenceKind = 'vacation' | 'study' | 'reserve' | 'course' | 'sick' // sick: a sickness on given days, e.g. starting tomorrow

export interface Constraint {
  id: string
  kind?: AbsenceKind // an absence (חופש, לימודים...); absent = an ordinary constraint
  when: 'dates' | 'weekdays' | 'always'
  from?: string // YYYY-MM-DD, `dates` only
  to?: string // YYYY-MM-DD, `dates` only; same as `from` for one day
  weekdays?: number[] // 0 = Sunday, `weekdays` only
  nightsOnly?: boolean // only night jobs are blocked; `always` is always nights only
  part?: DayPart // only this part of the day; absent = the whole day. Not with `nightsOnly`.
  reply?: string // YYYY-MM-DD, the Sunday of the WhatsApp reply this came from; a new paste for that week replaces it
  guess?: true // read from a WhatsApp reply whose words were not understood; shown so the manager checks it
  note?: string // free text, a pasted WhatsApp message or dictation
}

// Absent on workers saved before statuses existed; read as 'active' (`normalizeWorker`).
export type WorkerStatus = 'active' | 'sick' | 'inactive'

// The spec's single `name` is split into first and last name; the contact fields are the user's list.
export interface Worker {
  id: string
  firstName: string
  lastName: string
  birthDate?: string // YYYY-MM-DD
  address?: string
  mobilePhone?: string
  homePhone?: string
  emergencyPhone1?: string
  emergencyPhone2?: string
  roleIds: string[] // independent of each other: any combination is allowed
  certificationIds: string[]
  notes?: string
  constraints: Constraint[]
  status?: WorkerStatus // absent = active. Inactive: hidden from the list and never picked for a shift
  sickUntil?: string // YYYY-MM-DD, `sick` only: not picked for shifts up to and including this day
  idNumber?: string // ת.ז, 9 digits
  personalNumber?: string // מספר אישי
  departmentId?: string // one of the departments list
}

export interface ShiftDefinition {
  id: string
  name: string // "יום", "לילה"
  isStandby?: boolean // standby shift staffed by exactly 3 people
  requiredHeadcount?: number // usually 1 for a regular shift, 3 for standby
  requiredRoleIds: string[]
  requiredCertificationIds: string[]
  startTime: string // "07:00"
  endTime: string // "16:00"
  endsNextDay?: boolean // night job: starts in the morning, ends 16:00 the next day
  thenJob?: boolean // "לינה": a night job, then the same crew does another job before returning to base
}

// One person a job needs: the role they fill and, optionally, a certification they must hold.
// The automatic planner will read this. The role is never empty: the default is "כללי".
export interface StaffSlot {
  roleId: string
  certificationId?: string // older files: a single certification; read through slotCerts
  certificationIds?: string[] // the person in this place holds all of them
  alsoRoleIds?: string[] // roles the same person must also hold, e.g. a "מטפס" who is also "מנהל טיפוס"
  altRoleIds?: string[] // other roles that also fill this place, e.g. "מנהל טיפוס" in a "מטפס" place
  kindId?: string // the work kind (טיפוס, ריתוך) this place came from; absent = added by hand
}

// A kind of work with the people it needs, e.g. "טיפוס" = מנהל טיפוס + 2 מטפסים. Picking kinds in
// a job fills its staffing. One worker may fill places of different kinds at once (a climber who
// welds covers a "טיפוס" place and the "ריתוך" place), never two places of the same kind.
export interface WorkKind {
  id: string
  name: string
  staffing: StaffSlot[] // without `kindId`; it is added when the kind is picked in a job
  fixed?: number // repairs already made to this saved kind (see `repairKinds`), so each runs once
}

export interface CrewMember {
  workerId: string
  roleId: string // one of the worker's roles; "" when the worker has none yet
}

export type ClosureOutcome = 'done' | 'partial' | 'postponed'

// How a night job ended. Only night shifts (and urgent ones, which end the next day) are closed.
export interface ShiftClosure {
  outcome: ClosureOutcome
  note?: string // free text or dictation
  reasonIds: string[] // postpone reasons, for postponed
  // Partial only. Absent: the same task is reopened and goes back to "לשיבוץ" as it was.
  // Present: this task is closed and a follow-up task with what is left goes to "לשיבוץ", linked to it.
  followUp?: { location: string; jobDescription: string }
  closedAt: string // ISO time
}

// One real shift on one date. Replaces the spec's ShiftAssignment: the user's shifts carry a
// place, the nature of the work, and each worker's role in that shift.
export interface ShiftRecord {
  id: string
  date: string // YYYY-MM-DD, the day it starts
  shiftDefinitionId?: string // יום / לילה; may be empty for an urgent shift
  location: string
  jobDescription: string
  crew: CrewMember[]
  staffing: StaffSlot[] // who the job needs; one slot per person, except places of different kinds may share one
  workKindIds?: string[] // the work kinds picked for this job; their places are in `staffing`
  urgent?: boolean // opened "from now"
  startTime?: string // HH:mm, urgent shifts only: when it was opened
  endDate?: string // urgent shifts: default the next day
  endTime?: string // urgent shifts: default 16:00
  fromJobId?: string // scheduled from a job waiting in "לשיבוץ"
  closure?: ShiftClosure
  nextJob?: { location: string; jobDescription: string } // "לינה" only: the job after the night
  swaps?: CrewSwap[] // workers replaced after the shift was first saved, oldest first; for the archive
  pinnedIds?: string[] // crew members who must be in this job ("עובדים קבועים"): "שבץ" and swap advice never take them out
}

// One crew change in a saved shift: `outId` was replaced by `inId` in the place of role `roleId`.
export interface CrewSwap {
  at: string // ISO time the shift was saved with the change
  outId: string
  inId: string
  roleId: string
}

// A job that still needs a shift: left over from a partial or postponed night job, or added by hand.
export interface PendingJob {
  id: string
  location: string
  jobDescription: string
  staffing: StaffSlot[] // who the job needs; carried into the shift it is scheduled to
  shiftDefinitionId?: string // its "תבנית עבודה", chosen when the job is created; carried into the shift
  workKindIds?: string[] // its "סוג עבודה", chosen when the job is created; their places are in `staffing`
  fromShiftId?: string
  outcome?: Exclude<ClosureOutcome, 'done'>
  note?: string
  reasonIds: string[]
  createdAt: string // ISO time
  followUp?: true // a follow-up task: its text is what was left, not the original shift's
  // Set when the job is put into a shift. The job is kept, so cancelling that shift brings it back
  // and re-closing the original night job does not list it as waiting again.
  scheduledShiftId?: string
  pinnedIds?: string[] // workers the job must have ("עובדים שחייבים להיות"); carried into the shift it is scheduled to
}

// Something the manager told the voice assistant to remember ("טפסן ומטפס זה אותו דבר",
// "דני לא נוסע לאילת"). Sent with every turn; the model itself does not learn or change.
// A word the phone's voice says wrong, and how to write it so it comes out right (Settings, "הגייה").
// `say` may be in English letters: on some phones only that works ("טפסן" -> "Tapsan").
export interface Pronunciation {
  id: string
  word: string
  say: string
}

// A word the manager listened to in "אימון הגייה" and said sounds right as is.
export interface ApprovedWord {
  id: string
  word: string
}

// A word the assistant said that nobody listened to yet; it waits in "אימון הגייה".
export interface NewWord {
  id: string
  word: string
  at: string // ISO time it was first said
}

export interface AssistantNote {
  id: string
  text: string
  createdAt: string // ISO time
  learned?: true // written by the assistant from the manager's corrections, not dictated by him
}

// A request the manager confirmed and what the assistant did: shown to the model again later, so
// it answers the way this manager talks and works.
export interface AssistantExample {
  id: string
  said: string // what the manager said, corrections included
  did: string // the summary he confirmed
  createdAt: string // ISO time
  action?: ExampleAction // what was confirmed, when it is an action the app can learn to do alone (src/lib/freeCommands.ts)
}

// A confirmed action the app learns from: `said` is what the manager said for it, the rest what it did.
export type ExampleAction =
  | { type: 'job'; said: string; job: { date: string; shiftKindId: string; location: string; jobDescription: string; staffing: { roleId: string; count: number }[]; autoAssign: boolean } }
  | { type: 'sick'; said: string; workerId: string; until: string }

export interface PostponeReason {
  id: string
  name: string // "חסר אישור קונסטרוקטור", "תנאי מזג אויר"
}

// Places and descriptions of work the manager writes often. Suggestions only: a shift stores the text itself,
// so a renamed item is rewritten in the shifts that hold its old text, and a deleted one leaves them.
export interface Place {
  id: string
  name: string
}

export interface JobType {
  id: string
  name: string
}

// The department a worker belongs to. A worker holds the id, so a rename shows everywhere at once.
export interface Department {
  id: string
  name: string
}

// The manager's changes to one group of words that `readAnswer` reads constraints by. Only the
// changes are stored, so words added to the built-in table later still arrive.
export type WordGroup = 'morning' | 'noon' | 'evening' | 'wholeDay' | 'morningEvents' | 'events' | 'cant'

export interface WordGroupSetting {
  id: WordGroup
  added: string[]
  removed: string[] // built-in words the manager took out
}

// Stored in Drive appDataFolder as settings.json. Not in the spec; holds ids we must remember.
export interface AppSettings {
  calendarId?: string
}
