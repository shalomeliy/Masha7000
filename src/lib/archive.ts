import { fullName } from './catalog'
import { addDays, sortShifts } from './shifts'
import type { CrewSwap, PendingJob, ShiftRecord, Worker } from '../types/models'

// The archive: every shift ever saved, searched by dates, worker, place and free text.
// Pure rules, no I/O. Shifts are never pruned from shifts.json, so the archive is the whole history.

export interface ArchiveFilter {
  from: string // YYYY-MM-DD; empty = from the first shift
  to: string // YYYY-MM-DD; empty = up to the last shift
  workerId?: string
  location?: string // exact place, as written in the shifts
  text?: string
}

export const RANGES = [
  { id: 'month', label: 'חודש אחרון', days: 30 },
  { id: 'quarter', label: '3 חודשים', days: 91 },
  { id: 'half', label: 'חצי שנה', days: 182 },
  { id: 'all', label: 'הכול', days: 0 },
] as const

/** From/to for a quick range ending today; "הכול" leaves both open. */
export function rangeDates(days: number, today: string): { from: string; to: string } {
  return days ? { from: addDays(today, -days), to: today } : { from: '', to: '' }
}

const norm = (s: string) => s.trim().toLocaleLowerCase()

/** Worked in the shift, or was in it and swapped out. */
export const touchesWorker = (r: ShiftRecord, workerId: string) => r.crew.some((c) => c.workerId === workerId) || (r.swaps ?? []).some((s) => s.outId === workerId)

/** Everything a free-text search looks in: place, work, closing note, follow-up task, worker names. */
function searchText(r: ShiftRecord, workers: Worker[]): string {
  const ids = [...r.crew.map((c) => c.workerId), ...(r.swaps ?? []).map((s) => s.outId)]
  const names = ids.map((id) => workers.find((w) => w.id === id)).filter((w): w is Worker => !!w).map(fullName)
  const f = r.closure?.followUp
  return norm([r.location, r.jobDescription, r.closure?.note ?? '', f?.location ?? '', f?.jobDescription ?? '', ...names].join(' '))
}

/** The matching shifts, newest first. */
export function archiveShifts(records: ShiftRecord[], filter: ArchiveFilter, workers: Worker[]): ShiftRecord[] {
  const words = norm(filter.text ?? '').split(/\s+/).filter(Boolean)
  const place = filter.location ? norm(filter.location) : ''
  const hits = records.filter(
    (r) =>
      (!filter.from || r.date >= filter.from) &&
      (!filter.to || r.date <= filter.to) &&
      (!filter.workerId || touchesWorker(r, filter.workerId)) &&
      (!place || norm(r.location) === place) &&
      (!words.length || words.every((w) => searchText(r, workers).includes(w))),
  )
  return sortShifts(hits).reverse()
}

/** The places written in shifts, each once, in Hebrew order, for the place filter. */
export function archivePlaces(records: ShiftRecord[]): string[] {
  const seen = new Map<string, string>()
  for (const r of records) {
    const p = r.location.trim()
    if (p && !seen.has(norm(p))) seen.set(norm(p), p)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'he'))
}

export interface ArchiveSummary {
  shifts: number
  urgent: number
  done: number
  partial: number
  postponed: number
  swaps: number
}

export function archiveSummary(list: ShiftRecord[]): ArchiveSummary {
  const outcome = (o: string) => list.filter((r) => r.closure?.outcome === o).length
  return {
    shifts: list.length,
    urgent: list.filter((r) => r.urgent).length,
    done: outcome('done'),
    partial: outcome('partial'),
    postponed: outcome('postponed'),
    swaps: list.reduce((n, r) => n + (r.swaps?.length ?? 0), 0),
  }
}

/**
 * Where the task went on and where it came from, for the archive card:
 * the waiting job a partial / postponed shift left, and the shift a scheduled job came from.
 */
export function taskLinks(r: ShiftRecord, records: ShiftRecord[], jobs: PendingJob[]) {
  const left = jobs.find((j) => j.fromShiftId === r.id)
  const next = left?.scheduledShiftId ? records.find((s) => s.id === left.scheduledShiftId) : undefined
  const from = r.fromJobId ? jobs.find((j) => j.id === r.fromJobId) : undefined
  const prev = from?.fromShiftId ? records.find((s) => s.id === from.fromShiftId) : undefined
  return { left, next, prev }
}

/**
 * The crew changes between the saved crew and the edited one: a place (same index) whose worker
 * changed. Added and removed workers are not swaps. `before` empty = a new shift, no swaps.
 */
export function crewSwaps(before: ShiftRecord['crew'], after: ShiftRecord['crew'], at: string): CrewSwap[] {
  const out: CrewSwap[] = []
  before.forEach((b, i) => {
    const a = after[i]
    if (a && a.workerId !== b.workerId && !before.some((x) => x.workerId === a.workerId) && !after.some((x) => x.workerId === b.workerId)) {
      out.push({ at, outId: b.workerId, inId: a.workerId, roleId: a.roleId })
    }
  })
  return out
}
