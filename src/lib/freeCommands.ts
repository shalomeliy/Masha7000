import type { AppData, Proposal, Screen } from './assistant'
import { normalizeProposal } from './assistant'
import type { Edits } from './assistantEdits'
import { HINTS, type Hint } from './hint'
import { solve, type SolverOption } from './solvers'
import type { AssistantExample, ExampleAction } from '../types/models'

// Voice commands the app does by itself, free and instant, without asking Claude (the user's request,
// 2026-11-07: spend the Anthropic credit only on what really needs it). Two kinds:
//  - a fixed core: open a screen, the assistant's buttons, "who works tomorrow";
//  - actions learned from Claude: every confirmed request keeps what was said and what was done
//    (AssistantExample.action). From these the app learns the action words ("תפתח עבודה", "חולה"),
//    words of the manager's own that its lists do not have ("מטפסים" = טפסן), and which details the
//    action needs. A new request said the same way, with other names, days and places, is then done here.
// Safety: a request is handled here only when every word of it is explained; anything else goes to
// Claude. Nothing is saved without the manager's yes, as with Claude. Spikes: docs/spikes/free-commands.md,
// docs/spikes/learn-actions.md. Hebrew only: in another language everything goes to Claude.

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
const NUMBERS: Record<string, number> = {
  אחד: 1, אחת: 1, שניים: 2, שני: 2, שתיים: 2, שתי: 2, שלושה: 3, שלוש: 3, שלושת: 3, ארבעה: 4, ארבע: 4, חמישה: 5, חמש: 5, שישה: 6, שש: 6,
}
// Small words that carry no meaning in a command.
const FILLER = new Set(['לי', 'את', 'עם', 'של', 'גם', 'ו', 'אני', 'צריך', 'רוצה', 'בבקשה', 'יש', 'עוד', 'כולל', 'אתר', 'ה', 'אחד', 'אחת', 'הוא', 'היא', 'תודה', 'טוב', 'אוקיי'])
// Words that mean "assign people to it too".
const ASSIGN = /^(?:ו?תשבץ|ו?שבץ|ו?תשבצי|מישהו|אנשים)$/

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const plus = (now: Date, n: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n))

const words = (s: string) => s.replace(/[?!.,״"׳:;/]/g, ' ').split(/\s+/).filter(Boolean)
/** A word without one leading ב/ל/ה/ו: "באילת" -> "אילת". */
const bare = (w: string) => w.replace(/^(?:ו?[בלה]|ו)(?=.{2,})/, '')
const singular = (w: string) => w.replace(/(?:ים|ות)$/, '').replace(/א$/, 'אי') // חשמלאים -> חשמלאי

/** Two spellings of one name: equal without geresh, quotes and final letters, or one letter apart. */
function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[׳'"״`\-]/g, '').replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ')
  const x = norm(a)
  const y = norm(b)
  if (x === y) return true
  if (Math.min(x.length, y.length) < 3 || Math.abs(x.length - y.length) > 1) return false
  // At most one letter added, dropped or changed.
  let i = 0
  while (i < x.length && x[i] === y[i]) i++
  return x.slice(i + (x.length >= y.length ? 1 : 0)) === y.slice(i + (y.length >= x.length ? 1 : 0))
}

/** "היום", "מחר", "ביום שלישי 10.11": how a date is said back. */
export function dayText(date: string, now: Date): string {
  if (date === plus(now, 0)) return 'היום'
  if (date === plus(now, 1)) return 'מחר'
  const d = new Date(`${date}T12:00:00`)
  return `ביום ${DAYS[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}`
}

interface Found {
  date?: string
  shiftKindId?: string
  location?: string
  staffing: { roleId: string; count: number }[]
  workerIds: string[]
  description?: string
  rest: string[] // words not explained: action words, or things unknown
  restAt: number[] // their places in the sentence
}

/** Everything in the sentence that the app's own lists explain. */
function find(said: string, d: AppData, aliases: Record<string, string>, now: Date): Found {
  const ws = words(said)
  const used = new Array<boolean>(ws.length).fill(false)
  const out: Found = { staffing: [], workerIds: [], rest: [], restAt: [] }
  const take = (i: number, n = 1) => {
    for (let k = i; k < i + n; k++) used[k] = true
  }
  const isDayWord = (w: string) => /^(?:ב|ל)?יום$/.test(w)

  // Places: all the words of a known place, in a row (the first maybe with ב/ל).
  for (const p of d.places) {
    const pw = words(p.name)
    for (let i = 0; i + pw.length <= ws.length; i++) {
      if (pw.every((w, k) => (k === 0 ? bare(ws[i]) === w || ws[i] === w : ws[i + k] === w))) {
        if (!out.location || p.name.length > out.location.length) out.location = p.name
        take(i, pw.length)
      }
    }
  }
  // Workers: a first name, maybe with the last name.
  for (let i = 0; i < ws.length; i++) {
    if (used[i]) continue
    const w = d.workers.find((x) => x.status !== 'inactive' && (bare(ws[i]) === x.firstName || ws[i] === x.firstName))
    if (!w) continue
    out.workerIds.push(w.id)
    take(i)
    // The last name as speech recognition wrote it may differ a little from the card (תורגמן / תורג'מן).
    if (w.lastName && ws[i + 1] && !used[i + 1] && sameName(ws[i + 1], w.lastName)) take(i + 1)
  }
  // Kinds of job: "לינה", "כולל לינה", "עבודת לילה", "יום" (not the "יום" of "יום שלישי").
  for (let i = 0; i < ws.length; i++) {
    if (used[i]) continue
    if (/^ו?היום$/.test(ws[i])) continue // "היום" is today, not the kind "יום"
    const def = d.shiftDefinitions.find((s) => s.name === bare(ws[i]) || s.name === ws[i])
    if (!def || DAYS.includes(bare(ws[i + 1] ?? ''))) continue
    out.shiftKindId = def.id
    take(i)
    if (i > 0 && /^(?:עבודת|כולל|עם)$/.test(ws[i - 1])) take(i - 1)
  }
  // Dates.
  for (let i = 0; i < ws.length; i++) {
    if (used[i]) continue
    const w = ws[i]
    if (/^ו?(?:ה)?היום$/.test(w) || w === 'היום') (out.date = plus(now, 0)), take(i)
    else if (/^(?:ו|עד )?מחר$/.test(w)) (out.date = plus(now, 1)), take(i)
    else if (w === 'מחרתיים') (out.date = plus(now, 2)), take(i)
    else {
      const day = DAYS.indexOf(bare(w))
      const prev = ws[i - 1] ?? ''
      const next = ws[i + 1] ?? ''
      // "שני" in "שני מטפסים" is a count: a day comes after "יום", has ב/ל, or "הקרוב/הבא" after it.
      if (day < 0 || !(isDayWord(prev) || /^[בל]/.test(w) || /^(?:הקרוב|הבא)$/.test(next))) continue
      out.date = plus(now, (day - now.getDay() + 7) % 7 || 7)
      take(i)
      if (isDayWord(prev)) take(i - 1)
      if (/^(?:הקרוב|הבא)$/.test(next)) take(i + 1)
    }
  }
  // "עד" before a date: part of it.
  for (let i = 0; i < ws.length; i++) if (!used[i] && ws[i] === 'עד' && used[i + 1]) take(i)
  // Roles with a count: "שני מטפסים", "טכנאי מצלמות אחד", "חשמלאי".
  const roleAt = (i: number): [string, number] | null => {
    for (const r of d.roles) {
      const rw = words(r.name)
      if (rw.every((w, k) => !used[i + k] && (singular(bare(ws[i + k] ?? '')) === singular(w) || bare(ws[i + k] ?? '') === w))) return [r.id, rw.length]
    }
    const alias = aliases[singular(bare(ws[i] ?? ''))]
    return alias ? [alias, 1] : null
  }
  for (let i = 0; i < ws.length; i++) {
    if (used[i]) continue
    const r = roleAt(i)
    if (!r) continue
    let count = 1
    const before = ws[i - 1] ?? ''
    const after = ws[i + r[1]] ?? ''
    if (i > 0 && !used[i - 1] && (NUMBERS[before] || /^\d$/.test(before))) (count = NUMBERS[before] ?? Number(before)), take(i - 1)
    else if (NUMBERS[after] && !used[i + r[1]]) (count = NUMBERS[after]), take(i + r[1])
    out.staffing.push({ roleId: r[0], count })
    take(i, r[1])
  }
  // A known job type as the description.
  for (const j of d.jobTypes) {
    const jw = words(j.name)
    for (let i = 0; i + jw.length <= ws.length; i++) {
      if (jw.every((w, k) => !used[i + k] && ws[i + k] === w)) (out.description = j.name), take(i, jw.length)
    }
  }
  ws.forEach((w, i) => {
    if (!used[i] && !FILLER.has(w)) {
      out.rest.push(w)
      out.restAt.push(i)
    }
  })
  return out
}

// ---- What was learned from Claude's confirmed actions ----

export interface Learned {
  job: { words: string[][]; required: JobField[] } // action words of each example
  sick: { words: string[][]; needsDate: boolean }
  aliases: Record<string, string> // a word of the manager's -> roleId
}

type JobField = 'date' | 'shiftKindId' | 'location' | 'jobDescription' | 'staffing'
const JOB_FIELDS: JobField[] = ['date', 'shiftKindId', 'location', 'jobDescription', 'staffing']

/** What a confirmed proposal teaches, if it is an action the app can learn (one new job, or one worker sick). */
export function exampleAction(p: Proposal, asked: string[]): ExampleAction | undefined {
  if (!asked.length) return undefined
  // Notes and lessons may come with any action; they do not change what the action is.
  const others = p.assignShiftIds.length + p.workers.length + p.closeJobs.length + p.deleteJobIds.length
  // A new place or job type may be added to the lists together with the job.
  if (p.jobs.length === 1 && !others && !p.editJobs.length && !p.addConstraints.length && !p.editWorkers.length && !p.setCrews.length && !p.jobs[0].crew.length) {
    const j = p.jobs[0]
    return {
      type: 'job',
      said: asked.join(' / ').slice(0, 400),
      job: { date: j.date, shiftKindId: j.shiftKindId, location: j.location, jobDescription: j.jobDescription, staffing: j.staffing.map((s) => ({ roleId: s.roleId, count: s.count })), autoAssign: j.autoAssign },
    }
  }
  const sick = p.editWorkers.filter((w) => w.status === 'sick')
  // A replacement picked for him (crews, a moved job) and an absence of the same worker may come with it.
  const otherWorker = p.addConstraints.some((c) => c.workerId !== sick[0]?.workerId)
  if (sick.length === 1 && p.editWorkers.length === 1 && !p.jobs.length && !others && !p.listItems.length && !otherWorker) {
    // Only the first sentence: the rest is the choice of a replacement.
    return { type: 'sick', said: asked[0].slice(0, 200), workerId: sick[0].workerId, until: sick[0].sickUntil }
  }
  return undefined
}

export function learn(examples: AssistantExample[], d: AppData): Learned {
  const L: Learned = { job: { words: [], required: [] }, sick: { words: [], needsDate: false }, aliases: {} }
  const jobs: ExampleAction[] = []
  let sickWithDate = 0
  let sickCount = 0
  for (const ex of examples) {
    const a = ex.action
    if (!a) continue
    const then = new Date(ex.createdAt)
    if (a.type === 'job') {
      jobs.push(a)
      let f = find(a.said, d, L.aliases, then)
      // A role Claude understood that the lists do not name: the word after its count is its name.
      const ws = words(a.said)
      for (const s of a.job.staffing) {
        if (f.staffing.some((x) => x.roleId === s.roleId)) continue
        const i = ws.findIndex((w, k) => NUMBERS[ws[k - 1] ?? ''] === s.count && f.rest.includes(w))
        if (i >= 0) L.aliases[singular(bare(ws[i]))] = s.roleId
      }
      f = find(a.said, d, L.aliases, then)
      const desc = new Set(words(a.job.jobDescription))
      L.job.words.push(f.rest.filter((w) => !desc.has(w)).map(bare).filter((w) => !ASSIGN.test(w)))
    } else {
      const f = find(a.said, d, L.aliases, then)
      if (!f.workerIds.includes(a.workerId)) continue // the name was not said as the list has it
      sickCount++
      if (f.date) sickWithDate++
      L.sick.words.push(f.rest.map(bare))
    }
  }
  L.job.required = JOB_FIELDS.filter((k) => jobs.every((a) => a.type === 'job' && (k === 'staffing' ? a.job.staffing.length > 0 : Boolean(a.job[k]))))
  L.sick.needsDate = sickCount > 0 && sickWithDate === sickCount
  return L
}

/** True when all the action words of one learned example were said. */
const said = (examples: string[][], rest: string[]) => examples.some((ws) => ws.length > 0 && ws.every((w) => rest.includes(w)))

// ---- Handling a sentence ----

export interface PendingJob {
  job: { date: string; shiftKindId: string; location: string; jobDescription: string; staffing: { roleId: string; count: number }[]; autoAssign: boolean }
  missing: JobField[]
}

export type Local =
  | { kind: 'open'; screen: Screen; hint?: Hint; text: string }
  | { kind: 'say'; text: string }
  | { kind: 'propose'; proposal: Proposal }
  | { kind: 'advise'; spoken: string; options: SolverOption[]; extra: Edits; extraText: string }
  | { kind: 'ask'; question: string; pending: PendingJob }
  | null

const SCREENS: [RegExp, Screen][] = [
  [/^(?:ה)?(?:יומן|לוח|לוח העבודות|לוח זמנים)$/, 'calendar'],
  [/^(?:ה)?(?:שיבוץ|לשיבוץ|עבודות לשיבוץ|עבודות שמחכות|רשימת ההמתנה)$/, 'toSchedule'],
  [/^(?:ה)?(?:עובדים|רשימת העובדים|רשימת עובדים|צוות)$/, 'workers'],
  [/^(?:ה)?(?:ארכיון|היסטוריה|דוחות)$/, 'archive'],
  [/^(?:ה)?(?:הגדרות)$/, 'settings'],
]
const SCREEN_NAME: Record<Screen, string> = { calendar: 'היומן', toSchedule: 'לשיבוץ', workers: 'העובדים', archive: 'הארכיון', settings: 'ההגדרות' }

const BUTTONS: [RegExp, Hint, string][] = [
  [/^(?:תשלח|תשתף|שלח|שתף|תפיץ)(?: לי)?(?: לצוות| לעובדים)? (?:את )?(?:ה)?(?:שבוע|סידור|סידור השבועי|סידור של השבוע|לוח של השבוע)(?: בווטסאפ| לצוות| לעובדים| לקבוצה)?$/, 'shareWeek', 'הנה הכפתור לשליחת הסידור.'],
  [/^(?:(?:תפתח|פתח|יש לי|צריך|תוסיף)(?: לי)? )?(?:עבודה )?(?:דחופה|קריאה דחופה|עבודה דחופה)$/, 'urgentNow', 'הנה הכפתור לעבודה דחופה.'],
  [/^(?:(?:תבקש|בקש|תשלח|שלח)(?: מה(?:עובדים|צוות))? (?:את )?(?:ה)?אילוצים(?: מה(?:עובדים|צוות))?)$/, 'requestConstraints', 'הנה הכפתור לבקשת אילוצים.'],
  [/^(?:תשלח|שלח|תן לי|תביא לי|תיצור|צור)(?: לי)? (?:את )?(?:ה)?(?:קישור|לינק) (?:ה)?(?:הצטרפות|להצטרפות|לעובד חדש)$/, 'joinLink', 'הנה הקישור להצטרפות.'],
]

function clean(s: string): string {
  return s
    .replace(/[?!.,״"׳']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:היי|הי|שלום|טוב|אוקיי|אוקי|יאללה)\s+/, '')
    .replace(/\s+(?:בבקשה|תודה|רגע|עכשיו)$/, '')
    .replace(/^(?:בבקשה|אפשר|תוכלי|תוכל)\s+/, '')
}

/** The fixed core: screens, the assistant's buttons, who works on a day. */
function fixed(text: string, d: AppData, now: Date): Local {
  const s = clean(text)
  if (!s || s.split(' ').length > 9) return null
  const open = /^(?:(?:תפתח|פתח|תפתחי|תראה|הראה|תציג|לך|תעבור|עבור|תעביר|קח)(?: לי(?= |$)| אותי)?(?: את| ל| אל| למסך| למסך של)? ?)?(.+)$/.exec(s)
  if (open) {
    const target = open[1].replace(/^(?:מסך |מסך ה|את )/, '').replace(/^ל(?=יומן|עובדים|הגדרות|ארכיון)/, '')
    for (const [re, screen] of SCREENS) if (re.test(target)) return { kind: 'open', screen, text: `פותח את ${SCREEN_NAME[screen]}.` }
  }
  for (const [re, hint, text] of BUTTONS) if (re.test(s)) return { kind: 'open', screen: HINTS[hint], hint, text }
  const who = /^(?:מי (?:עובד|עובדים|יוצא|יוצאים|בעבודה|משובץ|משובצים)|מה יש(?: לנו)?|איזה עבודות יש|אילו עבודות יש|מה העבודות|מה הסידור|מה מתוכנן|יש עבודות) (.+)$/.exec(s)
  if (who) {
    const f = find(who[1], d, {}, now)
    if (f.date && !f.rest.length && !f.location && !f.workerIds.length && !f.staffing.length) return { kind: 'say', text: whoWorks(f.date, d, now) }
  }
  return null
}

/** "Who works" from the data, said back. */
export function whoWorks(date: string, d: AppData, now: Date): string {
  const day = d.shifts.filter((s) => s.date === date)
  const when = dayText(date, now)
  if (!day.length) return `${when} אין עבודות.`
  const name = (id: string) => {
    const w = d.workers.find((x) => x.id === id)
    return w ? `${w.firstName} ${w.lastName}`.trim() : 'עובד שנמחק'
  }
  const parts = day.map((s) => {
    const kind = d.shiftDefinitions.find((k) => k.id === s.shiftDefinitionId)?.name
    const crew = s.crew.length ? s.crew.map((c) => name(c.workerId)).join(', ') : 'עוד אין צוות'
    return `${kind ? `${kind} ` : ''}ב${s.location}: ${crew}`
  })
  return `${when} ${day.length === 1 ? 'יש עבודה אחת' : `יש ${day.length} עבודות`}. ${parts.join('. ')}.`
}

const QUESTIONS: Record<JobField, (d: AppData) => string> = {
  date: () => 'באיזה יום?',
  shiftKindId: (d) => `איזו עבודה, ${d.shiftDefinitions.map((s) => s.name).join(', ')}?`,
  location: () => 'איפה?',
  jobDescription: () => 'מה עושים שם?',
  staffing: () => 'כמה אנשים צריך, ובאיזה תפקיד?',
}

function jobProposal(job: PendingJob['job'], d: AppData, now: Date): Proposal {
  const kind = d.shiftDefinitions.find((s) => s.id === job.shiftKindId)?.name ?? ''
  const staff = job.staffing.map((s) => {
    const r = d.roles.find((x) => x.id === s.roleId)?.name ?? ''
    return s.count === 1 ? r : `${s.count} ${r}`
  })
  const when = job.date ? dayText(job.date, now) : 'בלי תאריך, לרשימת לשיבוץ'
  const summary = `עבודה חדשה: ${kind ? `${kind} ` : ''}${when}, ב${job.location}, ${job.jobDescription}. צריך ${staff.join(' ו')}.${job.autoAssign ? ' ואשבץ אנשים.' : ''} לאשר, או שיש עוד תיקון?`
  return {
    ...normalizeProposal({}),
    summary,
    jobs: [{ ...job, staffing: job.staffing.map((s) => ({ ...s, certificationIds: [] })), workKindIds: [], note: '', nextJob: { location: '', jobDescription: '' }, crew: [] }],
  }
}

const missingOf = (job: PendingJob['job'], required: JobField[]) => required.filter((k) => (k === 'staffing' ? !job.staffing.length : !job[k]))

/** A new job said the way a learned one was. */
function learnedJob(text: string, d: AppData, L: Learned, now: Date): Local {
  const f = find(text, d, L.aliases, now)
  if (f.workerIds.length) return null // naming workers is beyond what was learned
  const rest = f.rest.map(bare)
  if (!said(L.job.words, rest.filter((w) => !ASSIGN.test(w)))) return null
  const action = new Set(L.job.words.flat())
  const unknownAt = f.restAt.filter((_, k) => !action.has(rest[k]) && !ASSIGN.test(rest[k]))
  let description = f.description ?? ''
  if (unknownAt.length) {
    // Unexplained words are the description only when there is no known one, and they stand together.
    if (description || unknownAt.some((at, k) => k > 0 && at !== unknownAt[k - 1] + 1)) return null
    const ws = words(text)
    description = unknownAt.map((at) => ws[at]).join(' ')
  }
  const job = { date: f.date ?? '', shiftKindId: f.shiftKindId ?? '', location: f.location ?? '', jobDescription: description, staffing: f.staffing, autoAssign: rest.some((w) => ASSIGN.test(w)) }
  const missing = missingOf(job, L.job.required)
  if (missing.length) return { kind: 'ask', question: QUESTIONS[missing[0]](d), pending: { job, missing } }
  return { kind: 'propose', proposal: jobProposal(job, d, now) }
}

/** The answer to a question about a missing detail of a job being opened here. */
export function continueJob(text: string, p: PendingJob, d: AppData, L: Learned, now: Date): Local {
  const field = p.missing[0]
  const f = find(text, d, L.aliases, now)
  const job = { ...p.job }
  if (f.workerIds.length) return null
  if (field === 'jobDescription' && !f.description) {
    const t = clean(text)
    if (!t || f.date || f.location || f.staffing.length) return null
    job.jobDescription = t
  } else {
    if (f.rest.length) return null // something more than the answer: Claude
    if (f.date) job.date = f.date
    if (f.shiftKindId) job.shiftKindId = f.shiftKindId
    if (f.location) job.location = f.location
    if (f.description) job.jobDescription = f.description
    if (f.staffing.length) job.staffing = f.staffing
  }
  const missing = missingOf(job, L.job.required)
  if (missing.length && missing[0] === field) return null // the answer did not answer: Claude
  if (missing.length) return { kind: 'ask', question: QUESTIONS[missing[0]](d), pending: { job, missing } }
  return { kind: 'propose', proposal: jobProposal(job, d, now) }
}

/** "יוסי חולה היום", said the way a learned one was: mark sick, and offer a replacement when he is in a job. */
function learnedSick(text: string, d: AppData, L: Learned, now: Date): Local {
  const f = find(text, d, L.aliases, now)
  if (f.workerIds.length !== 1 || f.location || f.staffing.length || f.shiftKindId || f.description) return null
  const rest = f.rest.map(bare)
  if (!said(L.sick.words, rest)) return null
  const action = new Set(L.sick.words.flat())
  if (rest.some((w) => !action.has(w))) return null
  if (L.sick.needsDate && !f.date) return null
  const until = f.date ?? plus(now, 0)
  if (until < plus(now, 0)) return null
  const w = d.workers.find((x) => x.id === f.workerIds[0])!
  const name = `${w.firstName} ${w.lastName}`.trim()
  const extra: Edits = {
    editJobs: [],
    setCrews: [],
    closeJobs: [],
    deleteJobIds: [],
    editWorkers: [{ workerId: w.id, mobilePhone: '', addRoleIds: [], removeRoleIds: [], addCertificationIds: [], removeCertificationIds: [], status: 'sick', sickUntil: until }],
    addConstraints: [],
  }
  const sickText = `${name} חולה עד ${until === plus(now, 0) ? 'היום' : dayText(until, now).replace(/^ביום /, 'יום ')}`
  // Jobs he is in, from today to the last sick day.
  const jobs = d.shifts.filter((s) => !s.closure && s.date >= plus(now, 0) && s.date <= until && s.crew.some((c) => c.workerId === w.id)).sort((a, b) => a.date.localeCompare(b.date))
  if (jobs.length) {
    const job = jobs[0]
    const options = solve(d, { kind: 'missing', shiftId: job.id, workerIds: [w.id] })
    const more = jobs.length > 1 ? ` יש לו עוד ${jobs.length - 1} עבודות עד שיחזור, נטפל בהן אחר כך.` : ''
    const where = `${w.firstName} משובץ ${dayText(job.date, now)} בעבודה ב${job.location}.`
    if (options.length) {
      const o = options[0]
      return { kind: 'advise', spoken: `${where} ${o.title}: ${o.actions.join(', ')}. לעשות את זה, או פתרון אחר?${more}`, options, extra, extraText: sickText }
    }
    return {
      kind: 'propose',
      proposal: { ...normalizeProposal({}), ...extra, summary: `${sickText}. ${where} לא מצאתי מחליף פנוי, אפשר לטפל בזה ביומן.${more} לאשר, או שיש עוד תיקון?` },
    }
  }
  return { kind: 'propose', proposal: { ...normalizeProposal({}), ...extra, summary: `${sickText}. הוא לא משובץ לעבודה בימים האלה. לאשר, או שיש עוד תיקון?` } }
}

/** The first sentence of a conversation: handled here, or null for Claude. */
export function handleFree(text: string, d: AppData, L: Learned, now = new Date()): Local {
  return fixed(text, d, now) ?? learnedSick(text, d, L, now) ?? learnedJob(text, d, L, now)
}

// ---- How many turns were free this month (shown on the assistant screen, kept on this device) ----

const USAGE_KEY = 'assistant.usage'
export interface Usage {
  month: string
  free: number
  paid: number
}

export function usage(now = new Date()): Usage {
  const month = iso(now).slice(0, 7)
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_KEY) ?? 'null') as Usage | null
    if (u && u.month === month) return u
  } catch {
    // no storage
  }
  return { month, free: 0, paid: 0 }
}

export function countTurn(kind: 'free' | 'paid', now = new Date()): Usage {
  const u = usage(now)
  const next = { ...u, [kind]: u[kind] + 1 }
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(next))
  } catch {
    // no storage: counts until reload
  }
  return next
}
