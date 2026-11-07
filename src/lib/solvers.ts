// Hard staffing problems solved by the app's own planner, in milliseconds; the voice assistant only
// recognizes the problem and then ranks and words these options (docs/spikes/solver.md). Every
// option carries the changes that carry it out, so picking one needs no further model call.

import { generalRoleId, isActive, staffingFor } from './catalog'
import { NO_EDITS, type Edits } from './assistantEdits'
import { autoAssign, type PlanContext } from './planner'
import { addDays, hebrewDayName, moveShift, showDate } from './shifts'
import type { AppData } from './assistant'
import type { ShiftRecord, StaffSlot } from '../types/models'

export type OptionKind = 'replace' | 'fill' | 'move' | 'short'

export interface SolverOption {
  kind: OptionKind
  title: string
  actions: string[]
  why: string
  cost: string
  changes: Edits
}

export type Problem =
  | { kind: 'missing'; shiftId: string; workerIds: string[] } // workers drop out of a job
  | { kind: 'job'; shiftId: string } // a job without its full crew
  | { kind: 'day'; date: string } // a day with jobs that lack people

// How far ahead a job may be moved to find a full crew.
const MOVE_DAYS = 10
export const MAX_OPTIONS = 3

// The kind of each choice in words, for the rule kept when the manager prefers another option.
export const KIND_TEXT: Record<OptionKind, string> = {
  replace: 'להכניס מחליף ולצאת בזמן',
  fill: 'להשלים אנשים ולצאת בזמן',
  move: 'להזיז את העבודה ליום שבו יש צוות מלא',
  short: 'לצאת בצוות חסר',
}

interface Setup {
  d: AppData
  general: string
  name: (id: string) => string
  slots: (s: ShiftRecord) => StaffSlot[]
  ctx: (excluded: string[], records?: ShiftRecord[]) => PlanContext
}

function setup(d: AppData): Setup {
  const general = generalRoleId(d.roles)
  const certIds = d.certifications.map((c) => c.id)
  return {
    d,
    general,
    name: (id) => d.workers.find((w) => w.id === id)?.firstName ?? '',
    slots: (s) => staffingFor(s.staffing, d.roles, certIds),
    ctx: (excluded, records = d.shifts) => ({ workers: d.workers.filter((w) => isActive(w) && !excluded.includes(w.id)), records, defs: d.shiftDefinitions, generalId: general }),
  }
}

const where = (s: ShiftRecord) => s.location || s.jobDescription || 'העבודה'
const when = (date: string) => `יום ${hebrewDayName(date)} ${showDate(date)}`
const names = (S: Setup, crew: ShiftRecord['crew']) => crew.map((c) => S.name(c.workerId)).filter(Boolean).join(', ')

/** Options for one job: fill it now (without `out`), move it to the first day a full crew fits, or go short. */
function jobOptions(S: Setup, shift: ShiftRecord, out: string[], records = S.d.shifts): SolverOption[] {
  const options: SolverOption[] = []
  const kept = shift.crew.filter((c) => !out.includes(c.workerId))
  const now = autoAssign({ ...shift, crew: kept }, S.slots(shift), S.ctx(out, records))
  const added = now.crew.filter((c) => !kept.some((k) => k.workerId === c.workerId))
  if (!now.unfilled.length) {
    options.push({
      kind: out.length ? 'replace' : 'fill',
      title: added.length ? `להכניס את ${added.map((c) => S.name(c.workerId)).join(' ו')}` : 'הצוות כבר מלא',
      actions: [`ב${where(shift)}, ${when(shift.date)}: ${names(S, now.crew)}`],
      why: 'יוצאים בזמן, וכל מי שנכנס מחזיק בתפקיד ובהסמכה ופנוי',
      cost: 'אין',
      changes: { ...NO_EDITS, setCrews: [{ shiftId: shift.id, crew: now.crew }] },
    })
  }
  // Moving is offered only when the job cannot go out full on its own day.
  for (let i = 1; i <= MOVE_DAYS && now.unfilled.length && !options.some((o) => o.kind === 'move'); i++) {
    const date = addDays(shift.date, i)
    const plan = autoAssign({ ...moveShift(shift, date), crew: [] }, S.slots(shift), S.ctx(out, records))
    if (plan.unfilled.length) continue
    options.push({
      kind: 'move',
      title: `להזיז ל${when(date)}`,
      actions: [`להזיז את ${where(shift)} ל-${showDate(date)}`, `לשבץ: ${names(S, plan.crew)}`],
      why: 'צוות מלא עם כל ההסמכות',
      cost: `העבודה מתעכבת ${i === 1 ? 'ביום' : `ב-${i} ימים`}`,
      changes: { ...NO_EDITS, editJobs: [{ id: shift.id, date, shiftKindId: '', location: '', jobDescription: '', staffing: [], autoAssign: false }], setCrews: [{ shiftId: shift.id, crew: plan.crew }] },
    })
  }
  if (now.unfilled.length && now.crew.length) {
    options.push({
      kind: 'short',
      title: 'לצאת בצוות חסר',
      actions: [`ב${where(shift)}, ${when(shift.date)}: ${names(S, now.crew)}`],
      why: 'יוצאים בזמן',
      cost: `חסר ${now.unfilled.length === 1 ? 'אדם אחד' : `${now.unfilled.length} אנשים`}. ${now.why[0] ?? ''}`.trim(),
      changes: { ...NO_EDITS, setCrews: [{ shiftId: shift.id, crew: now.crew }] },
    })
  }
  return options
}

/** A day's jobs that lack people: fill what can be filled, and move the ones that cannot. */
function dayOptions(S: Setup, date: string): SolverOption[] {
  const jobs = S.d.shifts.filter((s) => s.date === date && !s.closure && s.crew.length < S.slots(s).length)
  if (!jobs.length) return []
  const merge = (list: SolverOption[]): Edits => ({
    ...NO_EDITS,
    editJobs: list.flatMap((o) => o.changes.editJobs),
    setCrews: list.flatMap((o) => o.changes.setCrews),
  })
  // Job by job, each seeing the crews already given to the ones before it (nobody twice on a day).
  const plan = (pick: (options: SolverOption[]) => SolverOption | undefined) => {
    let records = S.d.shifts
    const chosen: SolverOption[] = []
    for (const s of jobs) {
      const o = pick(jobOptions(S, s, [], records))
      if (!o) continue
      chosen.push(o)
      const crew = o.changes.setCrews[0]?.crew ?? s.crew
      const date = o.changes.editJobs[0]?.date || s.date
      records = records.map((r) => (r.id === s.id ? { ...moveShift(r, date), crew } : r))
    }
    return chosen
  }
  const options: SolverOption[] = []
  const full = plan((os) => os.find((o) => o.kind === 'fill') ?? os.find((o) => o.kind === 'move'))
  if (full.length) {
    const moves = full.filter((o) => o.kind === 'move')
    options.push({
      kind: moves.length ? 'move' : 'fill',
      title: moves.length ? 'להשלים מה שאפשר ולהזיז את השאר' : 'להשלים את כל העבודות',
      actions: full.flatMap((o) => o.actions),
      why: 'כל עבודה יוצאת עם צוות מלא',
      cost: moves.map((o) => o.cost).join('; ') || 'אין',
      changes: merge(full),
    })
  }
  // Or nothing moves: every job goes on that day with whoever can come.
  const stay = plan((os) => os.find((o) => o.kind === 'fill') ?? os.find((o) => o.kind === 'short'))
  if (stay.some((o) => o.kind === 'short')) {
    options.push({
      kind: 'short',
      title: 'לצאת ביום הזה עם מי שיש',
      actions: stay.flatMap((o) => o.actions),
      why: 'שום עבודה לא נדחית',
      cost: stay.filter((o) => o.kind === 'short').map((o) => o.cost).join('; '),
      changes: merge(stay),
    })
  }
  return options
}

/** Up to MAX_OPTIONS options for the problem, or [] when the planner has nothing to offer. */
export function solve(d: AppData, p: Problem): SolverOption[] {
  const S = setup(d)
  if (p.kind === 'day') return dayOptions(S, p.date).slice(0, MAX_OPTIONS)
  const shift = d.shifts.find((s) => s.id === p.shiftId)
  if (!shift) return []
  return jobOptions(S, shift, p.kind === 'missing' ? p.workerIds : []).slice(0, MAX_OPTIONS)
}

/** The options as the tool result the model ranks and words. */
export function optionsText(options: SolverOption[]): string {
  if (!options.length) return 'האפליקציה לא מצאה פתרון בעצמה. פתור את הבעיה עם advise.'
  const list = options.map((o, i) => `${i + 1}. ${o.title}: ${o.actions.join('; ')}. ${o.why}. מחיר: ${o.cost}`).join('\n')
  return `האפשרויות שהאפליקציה חישבה לפי כללי השיבוץ (אל תמציא אחרות):\n${list}\nקרא ל-rank: order = מספרי האפשרויות מהטובה לפחות טובה, אחרי שבדקת אותן מול remembered, examples ומה שהמנהל אמר; אפשר להשמיט אפשרות גרועה. notes = לכל אפשרות ב-order, הערה קצרה אם יש בעיה שהאפליקציה לא יודעת (למשל כלל מ-remembered), אחרת "". spoken = 1 עד 2 משפטים עם ההמלצה, ובסוף "לעשות את זה?" או "איזה פתרון לעשות?".`
}

/** The rule kept when the manager picks an option other than the one ranked first. */
export function preferenceLesson(problem: Problem['kind'], picked: OptionKind, top: OptionKind): string | null {
  if (picked === top) return null
  const what = problem === 'missing' ? 'כשעובד נופל מעבודה' : problem === 'day' ? 'כשחסרים אנשים ביום' : 'כשעבודה לא מאוישת'
  return `${what}, המנהל מעדיף ${KIND_TEXT[picked]}, ולא ${KIND_TEXT[top]}`
}
