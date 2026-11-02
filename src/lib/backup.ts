import { DRIVE_FILES } from './google/config'
import { createCopy, deleteCopy, forgetVersions, listCopies, peekJson, readCopy, writeJson } from './google/drive'
import type { DriveCopy } from './google/drive'
import { countText, normalizeShift, normalizeWorker, STARTER_DEPARTMENTS } from './catalog'
import { normalizePendingJob, normalizeShiftRecord } from './shifts'

// One file with every list, to keep outside the app or as a copy inside the app's Drive folder.
// A restore replaces every list with the backup's. A backup file comes from outside the app, so it is
// read as untrusted: JSON only, a size limit, and each list must have the shape the app reads.

export const APP_MARKER = 'masha7000'
export const BACKUP_VERSION = 1
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024

/** Every list, in restore order. settings.json (calendar id) belongs to the account, not the data. */
export const BACKUP_LISTS = [
  'roles',
  'certifications',
  'shiftDefinitions',
  'postponeReasons',
  'places',
  'jobTypes',
  'departments',
  'constraintWords',
  'workers',
  'pendingJobs',
  'shifts',
] as const
export type BackupList = (typeof BACKUP_LISTS)[number]

export const LIST_TITLES: Record<BackupList, string> = {
  roles: 'תפקידים',
  certifications: 'הסמכות',
  shiftDefinitions: 'תבניות עבודה',
  postponeReasons: 'סיבות דחייה',
  places: 'מקומות',
  jobTypes: 'סוגי עבודה',
  departments: 'מחלקות',
  constraintWords: 'מילים לקריאת אילוצים',
  workers: 'עובדים',
  pendingJobs: 'משימות לשיבוץ',
  shifts: 'עבודות',
}

export interface Backup {
  app: typeof APP_MARKER
  version: number
  createdAt: string
  files: Record<BackupList, Record<string, unknown>[]>
}

export const NOT_A_BACKUP = 'הקובץ הזה אינו גיבוי של האפליקציה.'
export class BackupError extends Error {}

export function makeBackup(files: Partial<Record<BackupList, unknown[] | null>>, now = new Date()): Backup {
  const all = {} as Backup['files']
  for (const k of BACKUP_LISTS) all[k] = (files[k] ?? (k === 'departments' ? STARTER_DEPARTMENTS : [])) as Record<string, unknown>[]
  return { app: APP_MARKER, version: BACKUP_VERSION, createdAt: now.toISOString(), files: all }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// Fields the screens show as text: anything else there would break the screen.
const TEXT_FIELDS = ['name', 'firstName', 'lastName', 'mobilePhone', 'location', 'jobDescription', 'notes', 'address', 'idNumber', 'personalNumber', 'departmentId']
const textFieldsOk = (item: Record<string, unknown>) => TEXT_FIELDS.every((f) => item[f] === undefined || item[f] === null || typeof item[f] === 'string')

// The same fill-in the app reads with, so older backups gain the fields added since.
const normalizers: Partial<Record<BackupList, (raw: never) => object>> = {
  workers: normalizeWorker,
  shiftDefinitions: normalizeShift,
  shifts: normalizeShiftRecord,
  pendingJobs: normalizePendingJob,
}

/** Reads a backup file's text; anything that is not a backup of this app throws BackupError, and nothing is used. */
export function parseBackup(text: string): Backup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BackupError(NOT_A_BACKUP)
  }
  if (!isObject(raw) || raw.app !== APP_MARKER || !isObject(raw.files) || typeof raw.createdAt !== 'string') throw new BackupError(NOT_A_BACKUP)
  if (raw.version !== BACKUP_VERSION) throw new BackupError('הגיבוי נוצר בגרסה אחרת של האפליקציה ואי אפשר לשחזר אותו.')
  if (Number.isNaN(Date.parse(raw.createdAt))) throw new BackupError(NOT_A_BACKUP)
  const files = {} as Backup['files']
  for (const k of BACKUP_LISTS) {
    // Backups made before departments existed: the starter list, as the app would read it.
    const list = k === 'departments' && raw.files[k] === undefined ? STARTER_DEPARTMENTS : raw.files[k]
    if (!Array.isArray(list)) throw new BackupError(`${NOT_A_BACKUP} חסרה בו הרשימה "${LIST_TITLES[k]}".`)
    for (const item of list)
      if (!isObject(item) || typeof item.id !== 'string' || (k === 'shifts' && typeof item.date !== 'string') || !textFieldsOk(item))
        throw new BackupError(`${NOT_A_BACKUP} הרשימה "${LIST_TITLES[k]}" פגומה.`)
    const fix = normalizers[k] as ((r: unknown) => Record<string, unknown>) | undefined
    files[k] = fix ? list.map(fix) : (list as Record<string, unknown>[])
  }
  return { app: APP_MARKER, version: BACKUP_VERSION, createdAt: raw.createdAt, files }
}

export function backupCounts(b: Backup) {
  return { workers: b.files.workers.length, shifts: b.files.shifts.length, pendingJobs: b.files.pendingJobs.length }
}

/** "18 עובדים, 412 עבודות, 6 משימות לשיבוץ" */
export function countsText(c: { workers: number; shifts: number; pendingJobs: number }): string {
  return [
    countText(c.workers, 'עובד אחד', 'עובדים'),
    countText(c.shifts, 'עבודה אחת', 'עבודות'),
    countText(c.pendingJobs, 'משימה אחת לשיבוץ', 'משימות לשיבוץ'),
  ].join(', ')
}

/** 29.10.2026, in the app's time zone. */
export function backupDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Asia/Jerusalem' }).replace(/\//g, '.')
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const backupFileName = (now = new Date()) => `masha7000-backup-${isoDay(now)}.json`

/** The Sunday that starts this week (Sunday to Saturday), as YYYY-MM-DD. */
export function weekStart(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
  return isoDay(d)
}

// ---- Copies inside the app's Drive folder ----

export const COPY_PREFIX = 'backup-'
export type CopyKind = 'weekly' | 'beforeRestore'
/** How many of each kind are kept; older ones are deleted. */
export const KEEP: Record<CopyKind, number> = { weekly: 8, beforeRestore: 3 }

export interface CopyInfo {
  id: string
  kind: CopyKind
  createdAt: string
  counts: { workers: number; shifts: number; pendingJobs: number }
}

export function toCopyInfo(f: DriveCopy): CopyInfo | null {
  const p = f.appProperties ?? {}
  if (!f.name.startsWith(COPY_PREFIX) || (p.kind !== 'weekly' && p.kind !== 'beforeRestore')) return null
  const n = (v?: string) => Number(v) || 0
  return { id: f.id, kind: p.kind, createdAt: p.createdAt ?? f.createdTime, counts: { workers: n(p.workers), shifts: n(p.shifts), pendingJobs: n(p.pendingJobs) } }
}

/** Copies past the number kept, newest first in, oldest out. */
export function copiesToDelete(copies: CopyInfo[]): CopyInfo[] {
  const sorted = [...copies].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return (['weekly', 'beforeRestore'] as const).flatMap((k) => sorted.filter((c) => c.kind === k).slice(KEEP[k]))
}

/** Was a weekly copy already made since this week's Sunday? */
export function hasWeeklyCopy(copies: CopyInfo[], now = new Date()): boolean {
  const start = weekStart(now)
  return copies.some((c) => c.kind === 'weekly' && isoDay(new Date(c.createdAt)) >= start)
}

/** Today's data straight from Drive (not the screens' cache). */
export async function readAll(now = new Date()): Promise<Backup> {
  const lists = await Promise.all(BACKUP_LISTS.map((k) => peekJson<unknown[]>(DRIVE_FILES[k])))
  return makeBackup(Object.fromEntries(BACKUP_LISTS.map((k, i) => [k, lists[i]])), now)
}

export async function listBackupCopies(): Promise<CopyInfo[]> {
  return (await listCopies(COPY_PREFIX)).map(toCopyInfo).filter((c): c is CopyInfo => c !== null)
}

/** Saves a copy of today's data; false when there was nothing to keep. Deleting old copies may fail quietly. */
export async function saveCopy(kind: CopyKind, now = new Date()): Promise<boolean> {
  const b = await readAll(now)
  // A new account has nothing to keep yet.
  if (kind === 'weekly' && BACKUP_LISTS.every((k) => b.files[k].length === 0)) return false
  const c = backupCounts(b)
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  await createCopy(`${COPY_PREFIX}${kind}-${stamp}.json`, JSON.stringify(b), {
    kind,
    createdAt: b.createdAt,
    workers: String(c.workers),
    shifts: String(c.shifts),
    pendingJobs: String(c.pendingJobs),
  })
  try {
    const old = copiesToDelete(await listBackupCopies())
    await Promise.all(old.map((o) => deleteCopy(o.id)))
  } catch {
    // An extra old copy is harmless; the next copy tries again.
  }
  return true
}

export async function readBackupCopy(id: string): Promise<Backup> {
  return parseBackup(await readCopy(id))
}

/**
 * Replaces each list with the backup's, one file at a time, skipping lists already done (a retry).
 * Uses the normal save, so a list someone else changed since this screen read it is refused.
 */
export async function restoreLists(b: Backup, done: ReadonlySet<BackupList>, onDone: (k: BackupList) => void, retry = false): Promise<void> {
  // A retry after "someone else saved" is the manager confirming again: replace those lists anyway.
  if (retry) forgetVersions(BACKUP_LISTS.filter((k) => !done.has(k)).map((k) => DRIVE_FILES[k]))
  for (const k of BACKUP_LISTS) {
    if (done.has(k)) continue
    await writeJson(DRIVE_FILES[k], b.files[k])
    onDone(k)
  }
}

const WEEKLY_KEY = 'masha7000.weeklyBackup'

/** On the first open of each week, saves a copy, unless someone already did this week. Never throws. */
export async function ensureWeeklyCopy(now = new Date()): Promise<boolean> {
  const week = weekStart(now)
  try {
    if (localStorage.getItem(WEEKLY_KEY) === week) return false
  } catch {
    // Storage blocked: ask Drive every time.
  }
  try {
    const made = !hasWeeklyCopy(await listBackupCopies(), now) && (await saveCopy('weekly', now))
    try {
      localStorage.setItem(WEEKLY_KEY, week)
    } catch {
      // ignore
    }
    return made
  } catch {
    return false // offline or signed out: try again on the next open
  }
}
