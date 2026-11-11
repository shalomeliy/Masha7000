import { DriveConflict, type Drive, type Read } from '../drive.js'
import { normalizePendingJob, normalizeShiftRecord, normalizeWorker, type StoredPendingJob, type StoredShift, type StoredWorker } from './normalize.js'

// The app's files as the outside API reads and writes them. Names as in DRIVE_FILES
// (src/lib/google/config.ts). Shifts: one file per month by the day each starts, as in
// src/lib/data/shiftMonths.ts. Writes change the raw stored object only in the fields asked, so
// whatever else the app keeps in it stays as it was.

export const FILES = {
  workers: 'workers.json',
  certifications: 'certifications.json',
  shiftKinds: 'shift_definitions.json',
  pendingJobs: 'pending_jobs.json',
  departments: 'departments.json',
  workKinds: 'work_kinds.json',
  legacyShifts: 'shifts.json',
} as const

const MONTH_FILE = /^shifts-(\d{4}-\d{2})\.json$/
export const monthFile = (date: string) => `shifts-${date.slice(0, 7)}.json`

type Raw = Record<string, unknown>

export async function readList(drive: Drive, name: string): Promise<{ read: Read<Raw[]>; list: Raw[] }> {
  const read = await drive.read<Raw[]>(name)
  return { read, list: Array.isArray(read.data) ? read.data : [] }
}

export async function workers(drive: Drive): Promise<StoredWorker[]> {
  return (await readList(drive, FILES.workers)).list.map(normalizeWorker)
}

export async function pendingJobs(drive: Drive): Promise<StoredPendingJob[]> {
  return (await readList(drive, FILES.pendingJobs)).list.map((j) => normalizePendingJob(j))
}

export async function named(drive: Drive, name: string): Promise<{ id: string; name: string }[]> {
  return (await readList(drive, name)).list.filter((x): x is { id: string; name: string } & Raw => typeof x.id === 'string' && typeof x.name === 'string')
}

const monthOfFile = (n: string) => n.match(MONTH_FILE)![1]

/** Every month file from `fromMonth` to `toMonth` (YYYY-MM), both included; all when left out. */
async function months(drive: Drive, fromMonth?: string, toMonth?: string): Promise<Read<Raw[]>[]> {
  const names = (await drive.names('shifts-', MONTH_FILE)).filter((n) => (!fromMonth || monthOfFile(n) >= fromMonth) && (!toMonth || monthOfFile(n) <= toMonth))
  return Promise.all(names.map((n) => drive.read<Raw[]>(n)))
}

/** Shifts starting from `from` to `to` (YYYY-MM-DD, both included), by date, one per id. */
export async function shiftsBetween(drive: Drive, from: string, to: string): Promise<StoredShift[]> {
  const reads = await months(drive, from.slice(0, 7), to.slice(0, 7))
  const seen = new Set<string>()
  return reads
    .flatMap((r) => (Array.isArray(r.data) ? r.data : []))
    .map(normalizeShiftRecord)
    .filter((s) => typeof s.id === 'string' && s.date >= from && s.date <= to && !seen.has(s.id) && (seen.add(s.id), true))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** The month file holding this shift, and the raw shift in it. */
export async function findShift(drive: Drive, id: string): Promise<{ read: Read<Raw[]>; raw: Raw } | null> {
  for (const read of await months(drive)) {
    const raw = (Array.isArray(read.data) ? read.data : []).find((s) => s.id === id)
    if (raw) return { read, raw }
  }
  return null
}

/** An app not yet updated may still keep every shift in one shifts.json; its next open splits it. */
export async function legacyShiftsLeft(drive: Drive) {
  return (await drive.read(FILES.legacyShifts)).id !== null
}

/** Puts a shift into the file of its month (adds or replaces by id), checking nobody changed that file. */
export async function putShift(drive: Drive, shift: Raw, sameMonth?: Read<Raw[]>) {
  const read = sameMonth ?? (await drive.read<Raw[]>(monthFile(String(shift.date))))
  const list = Array.isArray(read.data) ? read.data : []
  const at = list.findIndex((s) => s.id === shift.id)
  await drive.write(read, at < 0 ? [...list, shift] : list.map((s, i) => (i === at ? shift : s)))
}

/** Takes a shift out of the month file `read` saw. */
export async function dropShift(drive: Drive, read: Read<Raw[]>, id: string) {
  await drive.write(read, (read.data ?? []).filter((s) => s.id !== id))
}

export { DriveConflict }
