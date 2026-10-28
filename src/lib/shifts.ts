import { GENERAL_ROLE_ID, SHIFT_END, endsNextDay, fullName, newId } from './catalog'
import { dateError, todayIso } from './dates'
import type { PendingJob, ShiftClosure, ShiftDefinition, ShiftRecord, Worker } from '../types/models'

// Pure rules for real shifts: validation, the Sunday-to-Saturday week, closing a night job
// and the "לשיבוץ" list it feeds. No I/O here.

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** Adds days to a YYYY-MM-DD date, in UTC so daylight saving never shifts the day. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export const weekday = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
}

/** The Israeli work week holding `date`: Sunday to Saturday. */
export function weekOf(date: string): { start: string; end: string; days: string[] } {
  const start = addDays(date, -weekday(date))
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  return { start, end: days[6], days }
}

export const HEBREW_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

export const dayName = (date: string) => HEBREW_DAYS[weekday(date)]

export const showDate = (date: string) => {
  const [, m, d] = date.split('-')
  return `${Number(d)}.${Number(m)}`
}

/** Night job: a night shift type, or an urgent shift (it runs until the next afternoon). */
export function isNightShift(r: ShiftRecord, defs: ShiftDefinition[]): boolean {
  if (r.urgent) return true
  const def = defs.find((d) => d.id === r.shiftDefinitionId)
  return def ? endsNextDay(def) : false
}

/** A new urgent shift opened now: starts today at this minute, ends tomorrow 16:00 unless edited. */
export function urgentShift(now: Date, defs: ShiftDefinition[]): ShiftRecord {
  const date = todayIso(now)
  const night = defs.find((d) => endsNextDay(d))
  return {
    id: newId(),
    date,
    shiftDefinitionId: night?.id,
    location: '',
    jobDescription: '',
    crew: [],
    staffing: [],
    urgent: true,
    startTime: hhmm(now),
    endDate: addDays(date, 1),
    endTime: SHIFT_END,
  }
}

export function blankShift(date: string, from?: PendingJob): ShiftRecord {
  return {
    id: newId(),
    date,
    location: from?.location ?? '',
    jobDescription: from?.jobDescription ?? '',
    crew: [],
    staffing: from?.staffing ?? [],
    fromJobId: from?.id,
  }
}

/**
 * Error for a shift, or null. `roleIds` are the roles that still exist, so a deleted role does not count.
 * Every worker also holds the general role.
 */
export function shiftRecordError(r: ShiftRecord, workers: Worker[], roleIds?: string[], generalId = GENERAL_ROLE_ID): string | null {
  const d = dateError(r.date, { required: true })
  if (d) return d
  if (!r.urgent && !r.shiftDefinitionId) return 'צריך לבחור סוג משמרת'
  if (!r.location.trim() && !r.jobDescription.trim()) return 'צריך למלא מיקום או מהות עבודה'
  if (r.urgent) {
    if (!r.startTime || !TIME.test(r.startTime)) return 'צריך שעת התחלה'
    const e = dateError(r.endDate ?? '', { required: true, min: r.date })
    if (e) return `תאריך סיום: ${e}`
    if (!r.endTime || !TIME.test(r.endTime)) return 'צריך שעת סיום'
    if (r.endDate === r.date && r.endTime <= r.startTime) return 'שעת הסיום צריכה להיות אחרי שעת ההתחלה'
  }
  const seen = new Set<string>()
  for (const c of r.crew) {
    if (seen.has(c.workerId)) return 'אותו עובד מופיע פעמיים במשמרת'
    seen.add(c.workerId)
    const w = workers.find((x) => x.id === c.workerId)
    if (!w) return 'אחד העובדים במשמרת כבר לא קיים'
    const held = [generalId, ...(roleIds ? w.roleIds.filter((id) => roleIds.includes(id)) : w.roleIds)]
    if (!held.includes(c.roleId)) return `צריך לבחור תפקיד ל${fullName(w)}`
  }
  return null
}

/** How many shifts (urgent or not) the worker has in the week of `date`, leaving out `skipId`. */
export function weekShiftCount(workerId: string, date: string, records: ShiftRecord[], skipId?: string): number {
  const { start, end } = weekOf(date)
  return records.filter((r) => r.id !== skipId && r.date >= start && r.date <= end && r.crew.some((c) => c.workerId === workerId)).length
}

/** Shifts in date order; same day: urgent ones by start time after the planned ones. */
export function sortShifts(records: ShiftRecord[]): ShiftRecord[] {
  return [...records].sort((a, b) => a.date.localeCompare(b.date) || Number(!!a.urgent) - Number(!!b.urgent) || (a.startTime ?? '').localeCompare(b.startTime ?? ''))
}

export function closureError(c: Pick<ShiftClosure, 'outcome' | 'note' | 'reasonIds' | 'followUp'>): string | null {
  if (c.outcome === 'partial' && c.followUp && !c.followUp.jobDescription.trim()) return 'צריך לכתוב במשימת ההמשך מה נשאר לעשות'
  if (c.outcome === 'postponed' && !c.reasonIds.length && !c.note?.trim()) return 'צריך לבחור סיבה או לכתוב אותה'
  return null
}

/**
 * Closes (or re-closes, or reopens with `closure` undefined) a night job. Postponed, and partial
 * reopened, leave the same task in "לשיבוץ"; partial with a follow-up leaves the follow-up task.
 * Done or reopened removes it again. The task keeps `fromShiftId`, which links it to its history.
 */
export function applyClosure(
  records: ShiftRecord[],
  pending: PendingJob[],
  shiftId: string,
  closure: ShiftClosure | undefined,
): { records: ShiftRecord[]; pending: PendingJob[] } {
  const shift = records.find((r) => r.id === shiftId)
  if (!shift) return { records, pending }
  const nextRecords = records.map((r) => (r.id === shiftId ? { ...r, closure } : r))
  const existing = pending.find((j) => j.fromShiftId === shiftId)
  if (!closure || closure.outcome === 'done') {
    return { records: nextRecords, pending: existing ? pending.filter((j) => j.fromShiftId !== shiftId) : pending }
  }
  const job: PendingJob = {
    ...existing,
    id: existing?.id ?? newId(),
    location: closure.followUp?.location ?? shift.location,
    jobDescription: closure.followUp?.jobDescription ?? shift.jobDescription,
    followUp: closure.followUp ? true : undefined,
    staffing: existing?.staffing.length ? existing.staffing : shift.staffing,
    fromShiftId: shiftId,
    outcome: closure.outcome,
    note: closure.note,
    reasonIds: closure.reasonIds,
    createdAt: existing?.createdAt ?? closure.closedAt,
  }
  return { records: nextRecords, pending: existing ? pending.map((j) => (j.id === job.id ? job : j)) : [...pending, job] }
}

/** A job still shows in "לשיבוץ" until it sits in a shift that exists. */
export const isWaiting = (job: PendingJob, records: ShiftRecord[]) => !job.scheduledShiftId || !records.some((r) => r.id === job.scheduledShiftId)

/**
 * The waiting-jobs list after saving `shift`: the job it was scheduled from is marked scheduled,
 * and a job left over from this shift (partial / postponed) follows edits to its place and work.
 * Returns the same array when nothing changed, so no needless Drive write.
 */
export function pendingAfterShiftSave(pending: PendingJob[], shift: ShiftRecord): PendingJob[] {
  let changed = false
  const next = pending.map((j) => {
    if (j.id === shift.fromJobId && j.scheduledShiftId !== shift.id) {
      changed = true
      return { ...j, scheduledShiftId: shift.id }
    }
    if (j.fromShiftId === shift.id && !j.scheduledShiftId && !j.followUp && (j.location !== shift.location || j.jobDescription !== shift.jobDescription)) {
      changed = true
      return { ...j, location: shift.location, jobDescription: shift.jobDescription }
    }
    return j
  })
  return changed ? next : pending
}

export interface HistoryStep {
  shift: ShiftRecord
  job?: PendingJob // the task this shift was scheduled from, if any
}

/**
 * Every earlier step of a task, oldest first: the shift it came from, the task that shift was
 * scheduled from, the shift before that, and so on. The chain has no length limit.
 */
export function taskHistory(job: PendingJob, records: ShiftRecord[], jobs: PendingJob[]): HistoryStep[] {
  const steps: HistoryStep[] = []
  const seen = new Set<string>()
  let shift = records.find((r) => r.id === job.fromShiftId)
  while (shift && !seen.has(shift.id)) {
    seen.add(shift.id)
    const from = jobs.find((j) => j.id === shift?.fromJobId)
    steps.unshift({ shift, job: from })
    shift = from ? records.find((r) => r.id === from.fromShiftId) : undefined
  }
  return steps
}

/** Older or hand-edited files may lack lists; fill them so the screens can rely on them. */
export function normalizeShiftRecord(raw: Partial<ShiftRecord> & { id: string; date: string }): ShiftRecord {
  return { location: '', jobDescription: '', ...raw, crew: raw.crew ?? [], staffing: raw.staffing ?? [] }
}

export function normalizePendingJob(raw: Partial<PendingJob> & { id: string }): PendingJob {
  return { location: '', jobDescription: '', createdAt: '', ...raw, reasonIds: raw.reasonIds ?? [], staffing: raw.staffing ?? [] }
}

export const STARTER_POSTPONE_REASONS = ['חסר אישור קונסטרוקטור', 'תנאי מזג אויר']
