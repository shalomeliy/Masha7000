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
export interface Constraint {
  id: string
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
}

// One person a job needs: the role they fill and, optionally, a certification they must hold.
// The automatic planner will read this. The role is never empty: the default is "כללי".
export interface StaffSlot {
  roleId: string
  certificationId?: string
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
  staffing: StaffSlot[] // who the job needs; one slot per person
  urgent?: boolean // opened "from now"
  startTime?: string // HH:mm, urgent shifts only: when it was opened
  endDate?: string // urgent shifts: default the next day
  endTime?: string // urgent shifts: default 16:00
  fromJobId?: string // scheduled from a job waiting in "לשיבוץ"
  closure?: ShiftClosure
  swaps?: CrewSwap[] // workers replaced after the shift was first saved, oldest first; for the archive
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
  fromShiftId?: string
  outcome?: Exclude<ClosureOutcome, 'done'>
  note?: string
  reasonIds: string[]
  createdAt: string // ISO time
  followUp?: true // a follow-up task: its text is what was left, not the original shift's
  // Set when the job is put into a shift. The job is kept, so cancelling that shift brings it back
  // and re-closing the original night job does not list it as waiting again.
  scheduledShiftId?: string
}

export interface PostponeReason {
  id: string
  name: string // "חסר אישור קונסטרוקטור", "תנאי מזג אויר"
}

// Places and kinds of work the manager writes often. Suggestions only: a shift stores the text itself,
// so a renamed item is rewritten in the shifts that hold its old text, and a deleted one leaves them.
export interface Place {
  id: string
  name: string
}

export interface JobType {
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
