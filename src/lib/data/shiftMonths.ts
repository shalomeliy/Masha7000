import { DRIVE_FILES } from '../google/config'
import { expectAbsent, forgetVersions, listNames, peekJson, readJson, renameFile, writeJson } from '../google/drive'

// Shifts are kept one Drive file per month (shifts-2026-11.json), by the day each shift starts.
// A save writes only the months whose shifts changed, so its size stays a month's worth however
// long the history grows. Every month is still read when the app opens, so the screens and the
// archive see the whole list as before.
// The old single shifts.json is split into months the first time it is found, then renamed to
// shifts-old-<time>.json and kept untouched as a copy. If an app not yet updated writes shifts.json
// again, its list is split in the same way, and its shifts win over the month files' ones.
// The rename comes first and acts as a lock: of two managers opening at once, only the one whose
// rename found the file splits it. If the split fails, the file gets its old name back.
// A month file this screen did not read is expected not to exist, so a month someone else created
// meanwhile is a conflict, not overwritten. A shift moved between months is written to its new month
// before it leaves the old one, so a save cut in the middle shows it twice at worst (read keeps one).

const MONTH_FILE = /^shifts-(\d{4}-\d{2})\.json$/
const LEGACY = DRIVE_FILES.shifts

interface Dated {
  id: string
  date: string
}

export const monthFile = (month: string) => `shifts-${month}.json`
export const monthOf = (s: Dated) => s.date.slice(0, 7)

/** The shifts grouped by month, each month keeping the list's order. */
export function byMonth<T extends Dated>(list: T[]): Map<string, T[]> {
  const months = new Map<string, T[]>()
  for (const s of list) {
    const m = monthOf(s)
    months.set(m, [...(months.get(m) ?? []), s])
  }
  return months
}

/** One shift per id, the first one found. */
export function uniqueIds<T extends Dated>(list: T[]): T[] {
  const seen = new Set<string>()
  return list.filter((s) => !seen.has(s.id) && (seen.add(s.id), true))
}

/** The month files' shifts with an older full list laid over them: same id, the list's version wins. */
export function mergeLegacy<T extends Dated>(months: T[], legacy: T[]): T[] {
  const ids = new Set(legacy.map((s) => s.id))
  return [...months.filter((s) => !ids.has(s.id)), ...legacy]
}

/** Each month file as last read or written here, to write only what changed. */
const saved = new Map<string, string>()

async function readMonths<T>(baseline: boolean): Promise<{ months: Map<string, T[]>; found: boolean }> {
  const names = [...new Set(await listNames('shifts-', MONTH_FILE))].sort()
  const lists = await Promise.all(names.map((n) => (baseline ? readJson<T[]>(n) : peekJson<T[]>(n))))
  const months = new Map<string, T[]>()
  names.forEach((n, i) => {
    const list = lists[i] ?? []
    months.set(n.match(MONTH_FILE)![1], list)
    if (baseline) saved.set(n, JSON.stringify(list))
  })
  return { months, found: names.length > 0 }
}

/** Every shift, or null when nothing was ever saved. Splits an old shifts.json into months on the way. */
export async function readShifts<T extends Dated>(): Promise<T[] | null> {
  const old = `shifts-old-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const renamed = await renameFile(LEGACY, old)
  const [{ months, found }, legacy] = await Promise.all([readMonths<T>(true), renamed ? peekJson<T[]>(old) : null])
  const all = uniqueIds([...months.values()].flat())
  if (!legacy) return found || renamed ? all : null
  const merged = mergeLegacy(all, legacy)
  try {
    await saveShifts(merged)
  } catch (e) {
    await renameFile(old, LEGACY).catch(() => {})
    throw e
  }
  return merged
}

/** Every shift straight from Drive, without becoming the baseline for the conflict check (backups). */
export async function peekShifts<T extends Dated>(): Promise<T[]> {
  const [{ months }, legacy] = await Promise.all([readMonths<T>(false), peekJson<T[]>(LEGACY)])
  const all = uniqueIds([...months.values()].flat())
  return legacy ? mergeLegacy(all, legacy) : all
}

/** Writes the months whose shifts changed; a month left with no shifts is written empty. */
export async function saveShifts<T extends Dated>(list: T[]): Promise<void> {
  const next = byMonth(list)
  const changed = [...new Set([...[...next.keys()].map(monthFile), ...saved.keys()])]
    .sort()
    .map((name) => ({ name, body: next.get(name.match(MONTH_FILE)![1]) ?? [] }))
    .filter((m) => saved.get(m.name) !== JSON.stringify(m.body))
  // Months that gain a shift first, months that only lose shifts after.
  const had = (name: string) => new Set((JSON.parse(saved.get(name) || '[]') as Dated[]).map((s) => s.id))
  const gains = (m: (typeof changed)[number]) => m.body.some((s) => !had(m.name).has(s.id))
  for (const m of [...changed.filter(gains), ...changed.filter((m) => !gains(m))]) {
    if (!saved.has(m.name)) expectAbsent(m.name)
    await writeJson(m.name, m.body)
    saved.set(m.name, JSON.stringify(m.body))
  }
}

/** A restore replaces every month: those found on Drive now, not only the ones this screen read. */
export async function restoreShifts<T extends Dated>(list: T[], retry: boolean): Promise<void> {
  const names = await listNames('shifts-', MONTH_FILE)
  if (retry) forgetVersions([...names, ...saved.keys()])
  for (const n of names) if (!saved.has(n)) saved.set(n, '')
  await saveShifts(list)
  // A shifts.json left by an older app would be laid over the restored shifts on the next read.
  await renameFile(LEGACY, `shifts-old-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
}
