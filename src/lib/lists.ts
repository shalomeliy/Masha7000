import type { PendingJob, ShiftRecord } from '../types/models'

// Places and kinds of work: lists of names the manager picks from, while a shift keeps the text
// itself. Pure rules, no I/O.

export type TextField = 'location' | 'jobDescription'

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

/** How many shifts and waiting jobs hold exactly this text. */
export function textUsage(field: TextField, text: string, shifts: ShiftRecord[], jobs: PendingJob[]) {
  return { shifts: shifts.filter((s) => same(s[field], text)).length, jobs: jobs.filter((j) => same(j[field], text)).length }
}

/** A renamed item, rewritten where its old text was used. Lists that did not change come back as the same array. */
export function renameText(field: TextField, from: string, to: string, shifts: ShiftRecord[], jobs: PendingJob[]) {
  const u = textUsage(field, from, shifts, jobs)
  const fix = <T extends ShiftRecord | PendingJob>(x: T): T => (same(x[field], from) ? { ...x, [field]: to } : x)
  return { shifts: u.shifts ? shifts.map(fix) : shifts, jobs: u.jobs ? jobs.map(fix) : jobs }
}

/** The texts already written in shifts and jobs, most used first, for a list's first fill. Not in `known`. */
export function usedTexts(field: TextField, shifts: ShiftRecord[], jobs: PendingJob[], known: { name: string }[] = []): string[] {
  const counts = new Map<string, { text: string; n: number }>()
  for (const x of [...shifts, ...jobs]) {
    const text = x[field].trim()
    if (!text || text.includes('\n') || text.length > 60 || known.some((k) => same(k.name, text))) continue
    const key = text.toLocaleLowerCase()
    const c = counts.get(key) ?? { text, n: 0 }
    c.n++
    counts.set(key, c)
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.text.localeCompare(b.text, 'he')).map((c) => c.text)
}

/** Up to `max` names that hold what was typed, for the tap-to-fill chips under a field. Nothing when it is already one of them. */
export function suggestions(typed: string, names: string[], max = 8): string[] {
  const t = typed.trim().toLocaleLowerCase()
  if (names.some((n) => same(n, typed))) return []
  return names.filter((n) => n.toLocaleLowerCase().includes(t)).slice(0, max)
}
