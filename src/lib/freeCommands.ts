import type { AppData, Proposal, Screen } from './assistant'
import { isYes, normalizeProposal } from './assistant'
import type { Edits } from './assistantEdits'
import { HINTS, type Hint } from './hint'
import { closeName, nameDistance, nameLimit } from './nameMatch'
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
// Built in, from the first time (the user's request, 2026-11-07): any of these verbs with "עבודה", or
// "עבודה חדשה", opens a new job. Learned phrasings add to them.
const JOB_VERBS = new Set(
  ['תפתח', 'פתח', 'תפתחי', 'תפתחו', 'לפתוח', 'פתוח', 'נפתח', 'תייצר', 'תייצרי', 'תייצרו', 'תיצור', 'צור', 'ליצור', 'יצור', 'תכניס', 'הכנס', 'תכניסי', 'להכניס', 'הכניס', 'תוסיף', 'הוסף', 'תוסיפי', 'להוסיף', 'הוסיף', 'תרשום', 'רשום', 'תרשמי', 'לרשום', 'תקבע', 'קבע', 'תקבעי', 'לקבוע', 'קבוע', 'תשים', 'שים', 'תגדיר'],
)
const NEW_WORDS = new Set(['חדשה', 'חדש'])
// Words that never start a job's description: questions and other actions (they go to Claude).
const NOT_DESCRIPTION = /^(?:מה|מי|כמה|איפה|מתי|למה|איך|איזה|איזו|אילו|האם|תעביר|העבר|תזיז|הזז|תסגור|סגור|תבטל|בטל|תמחק|מחק|תדחה|דחה|תשנה|שנה|תבדוק|בדוק|תזכור|לא|אל|חולה)$/
// "העבודה" is a job that exists, "עבודות" more than one: not one new job.
const OTHER_JOB = /^(?:ו?ה|של|ו?ב|ו?ל)עבוד(?:ה|ות)$|^ו?עבודות$/
// Small words that carry no meaning in a command.
const FILLER = new Set(['לי', 'את', 'עם', 'של', 'גם', 'ו', 'אני', 'צריך', 'רוצה', 'בבקשה', 'יש', 'עוד', 'כולל', 'אתר', 'ה', 'אחד', 'אחת', 'הוא', 'היא', 'תודה', 'טוב', 'אוקיי'])
// Words that are never a worker's name, even when one sounds close ("חולה" is not "חולדה").
const NOT_NAMES = ['מישהו', 'מישהי', 'כולם', 'אף', 'הבן', 'הבת', 'הילד', 'הילדה', 'אשתי', 'בעלי', 'אמא', 'אבא', 'הם', 'הן', 'אתה', 'את', 'שלי', 'שלו', 'שלה']
const COMMON = new Set([
  ...NOT_NAMES,
  ...['חולה', 'חולים', 'חולות', 'מחלה', 'במחלה', 'עבודה', 'עבודות', 'עבודת', 'תפתח', 'פתח', 'תפתחי', 'תשבץ', 'שבץ', 'תסגור', 'תעביר', 'תבטל', 'תזיז', 'חדשה', 'חדש', ...JOB_VERBS],
  ...['לילה', 'יום', 'היום', 'מחר', 'מחרתיים', 'עד', 'בעוד', 'ימים', 'יומיים', 'שבוע', 'שבועיים', 'הקרוב', 'הבא', 'הבאה', 'חופש', 'חופשה', 'מילואים', 'אילוץ', 'לינה'],
])
// Words that mean "assign people to it too".
const ASSIGN = /^(?:ו?תשבץ|ו?שבץ|ו?תשבצי|מישהו|אנשים)$/

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const plus = (now: Date, n: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n))

const words = (s: string) =>
  s
    .replace(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/g, (_, a, b, c) => `${a}-${b}${c ? `-${c}` : ''}`) // "15.11" stays one word
    .replace(/[?!.,״"׳:;/]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
/** A word without one leading ב/ל/ה/ו: "באילת" -> "אילת". */
const bare = (w: string) => w.replace(/^(?:ו?[בלה]|ו)(?=.{2,})/, '')
const FINAL: Record<string, string> = { כ: 'ך', מ: 'ם', נ: 'ן', פ: 'ף', צ: 'ץ' }
// חשמלאים -> חשמלאי, טפסנים -> טפסן
const singular = (w: string) =>
  w
    .replace(/(?:ים|ות)$/, '')
    .replace(/א$/, 'אי')
    .replace(/[כמנפצ]$/, (c) => FINAL[c])

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
  // A name said that is about equally close to more than one worker: the app asks which one.
  unsure: { at: number; n: number; ids: string[] }[]
  description?: string
  rest: string[] // words not explained: action words, or things unknown
  restAt: number[] // their places in the sentence
}

/** Everything in the sentence that the app's own lists explain. */
function find(said: string, d: AppData, aliases: Record<string, string>, now: Date, protect: Set<string> = new Set()): Found {
  const ws = words(said)
  const used = new Array<boolean>(ws.length).fill(false)
  const out: Found = { staffing: [], workerIds: [], unsure: [], rest: [], restAt: [] }
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
  // Workers said exactly by first name (maybe with the last name); the rest of the names come last, by closeness.
  const workerAt = (i: number, exact: boolean) => {
    if (used[i]) return
    const said1 = ws[i]
    if (!exact && (FILLER.has(said1) || COMMON.has(said1) || COMMON.has(bare(said1)) || protect.has(bare(said1)))) return
    const near = (heard: string, name: string) => Math.min(nameDistance(heard, name), nameDistance(bare(heard), name))
    const next = ws[i + 1] && !used[i + 1] ? ws[i + 1] : ''
    const scored = d.workers
      .filter((x) => x.status !== 'inactive')
      .map((x) => {
        const first = exact ? (bare(said1) === x.firstName || said1 === x.firstName ? 0 : Infinity) : near(said1, x.firstName)
        const last = next && x.lastName ? nameDistance(next, x.lastName) : Infinity
        return { x, first, last: last <= nameLimit(x.lastName) ? last : Infinity }
      })
      .filter((c) => c.first <= nameLimit(c.x.firstName))
    if (!scored.length) return
    // The last name said too decides between workers of one first name.
    const withLast = scored.filter((c) => c.last < Infinity)
    const pool = withLast.length ? withLast : scored
    const total = (c: (typeof pool)[number]) => c.first + (withLast.length ? c.last : 0)
    const best = Math.min(...pool.map(total))
    // Equally close (an exact name beats any near one): ask which.
    const tied = pool.filter((c) => (best === 0 ? total(c) === 0 : total(c) <= best + 0.5))
    const n = withLast.length ? 2 : 1
    if (tied.length === 1) out.workerIds.push(tied[0].x.id)
    else out.unsure.push({ at: i, n, ids: tied.map((c) => c.x.id) })
    take(i, n)
  }
  for (let i = 0; i < ws.length; i++) workerAt(i, true)
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
  // "15.11", "ב-15.11.26", "עד 20.11": a day and month, the next one from today when no year is said.
  for (let i = 0; i < ws.length; i++) {
    if (used[i]) continue
    const m = /^(?:ו?[בל]-?|עד-?)?(\d{1,2})-(\d{1,2})(?:-(\d{2,4}))?$/.exec(ws[i])
    if (!m) continue
    const [day, month] = [Number(m[1]), Number(m[2])]
    let year = m[3] ? Number(m[3]) + (m[3].length === 2 ? 2000 : 0) : now.getFullYear()
    const at = (y: number) => new Date(y, month - 1, day)
    if (!m[3] && iso(at(year)) < plus(now, 0)) year++
    const date = at(year)
    if (date.getMonth() !== month - 1 || date.getDate() !== day) continue // not a real date
    out.date = iso(date)
    take(i)
  }
  // "בעוד יומיים", "עוד שבוע", "בעוד 3 ימים".
  for (let i = 0; i < ws.length; i++) {
    if (used[i] || !/^(?:ב)?עוד$/.test(ws[i])) continue
    const SPANS: Record<string, number> = { יומיים: 2, שבוע: 7, שבועיים: 14 }
    const n = NUMBERS[ws[i + 1] ?? ''] ?? (/^\d{1,2}$/.test(ws[i + 1] ?? '') ? Number(ws[i + 1]) : 0)
    if (SPANS[ws[i + 1] ?? '']) (out.date = plus(now, SPANS[ws[i + 1]])), take(i, 2)
    else if (n && /^(?:ימים|יום)$/.test(ws[i + 2] ?? '')) (out.date = plus(now, n)), take(i, 3)
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
    if (i > 0 && !used[i - 1] && (NUMBERS[before] || /^\d{1,2}$/.test(before))) (count = NUMBERS[before] ?? Number(before)), take(i - 1)
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
  // Names not said exactly: the closest worker, when one is close enough (typos, speech recognition, English).
  for (let i = 0; i < ws.length; i++) workerAt(i, false)
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
  job: { words: string[][] } // action words of each learned example (the built-in verbs come on top: JOB_VERBS)
  sick: { words: string[][]; needsDate: boolean }
  aliases: Record<string, string> // a word of the manager's -> roleId
  protect: Set<string> // learned action words: never read as a worker's name
}

type JobField = 'date' | 'shiftKindId' | 'location' | 'jobDescription' | 'staffing'

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
  // A sickness ahead ("חולה מחר") is saved as an absence on that day.
  const absence = p.addConstraints
  if (!sick.length && absence.length === 1 && /מחל|חול/.test(absence[0].note) && !p.editWorkers.length && !p.jobs.length && !others && !p.listItems.length) {
    return { type: 'sick', said: asked[0].slice(0, 200), workerId: absence[0].workerId, until: absence[0].to || absence[0].from }
  }
  return undefined
}

export function learn(examples: AssistantExample[], d: AppData): Learned {
  const L: Learned = { job: { words: [] }, sick: { words: [], needsDate: false }, aliases: {}, protect: new Set() }
  for (const ex of examples) {
    const a = ex.action
    if (!a) continue
    const then = new Date(ex.createdAt)
    if (a.type === 'job') {
      let f = find(a.said, d, L.aliases, then)
      // A role Claude understood that the lists do not name: the word after its count is its name.
      const ws = words(a.said)
      for (const s of a.job.staffing) {
        if (f.staffing.some((x) => x.roleId === s.roleId)) continue
        const i = ws.findIndex((w, k) => NUMBERS[ws[k - 1] ?? ''] === s.count && f.rest.includes(w))
        if (i >= 0) L.aliases[singular(bare(ws[i]))] = s.roleId
      }
      f = find(a.said, d, L.aliases, then)
      // The action's own values are slots, never part of the template, also when the lists did not explain them.
      const slots = slotWords([a.job.jobDescription, a.job.location])
      L.job.words.push(f.rest.map(bare).filter((w, k) => !slots.has(w) && !slots.has(f.rest[k]) && !isValue(w) && !ASSIGN.test(w)))
    } else {
      const f = find(a.said, d, L.aliases, then)
      const w = d.workers.find((x) => x.id === a.workerId)
      // The worker's name is a slot: it is the name said, however it was spelled.
      const name = f.rest.filter((x) => w && (closeName(x, w.firstName) || closeName(bare(x), w.firstName) || closeName(x, w.lastName)))
      if (!f.workerIds.includes(a.workerId) && !name.length) continue // the sentence does not name him
      L.sick.words.push(f.rest.filter((x) => !name.includes(x)).map(bare).filter((x) => !isValue(x)))
    }
  }
  for (const ws of [...L.job.words, ...L.sick.words]) for (const w of ws) L.protect.add(w)
  // Built in, from the first time (the user's request): "<worker> חולה <when>". Learned phrasings add to it.
  L.sick.words.push(['חולה'])
  L.sick.needsDate = false
  return L
}

/** The words of a value (a place, a description): each also without its ב/ל/ה. */
const slotWords = (values: string[]) => new Set(values.flatMap((v) => words(v ?? '')).flatMap((w) => [w, bare(w)]))
/** A number or a date written in digits: always a value. */
const isValue = (w: string) => /\d/.test(w)

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
  | { kind: 'which'; question: string; pending: PendingWho }
  | null

/** A name said that is about equally close to more than one worker, waiting for the manager to say which. */
export interface PendingWho {
  text: string // the sentence as said
  at: number // where the name is in it (words)
  n: number // how many words the name took
  ids: string[] // the workers it may be
}

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
    if (f.date && !f.rest.length && !f.location && !f.workerIds.length && !f.unsure.length && !f.staffing.length) return { kind: 'say', text: whoWorks(f.date, d, now) }
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
  const when = job.date ? `${kind ? `${kind} ` : ''}${dayText(job.date, now)}` : `${kind ? `${kind}, ` : ''}בלי תאריך, לרשימת לשיבוץ`
  const parts = [when, job.location ? `ב${job.location}` : '', job.jobDescription].filter(Boolean)
  const need = staff.length ? ` צריך ${staff.join(' ו')}.` : ''
  const summary = `עבודה חדשה: ${parts.join(', ')}.${need}${job.autoAssign ? ' ואשבץ אנשים.' : ''} לאשר, או שיש עוד תיקון?`
  return {
    ...normalizeProposal({}),
    summary,
    jobs: [{ ...job, staffing: job.staffing.map((s) => ({ ...s, certificationIds: [] })), workKindIds: [], note: '', nextJob: { location: '', jobDescription: '' }, crew: [] }],
  }
}

/**
 * What a new job cannot be saved without. Everything else may be left out (the user's request,
 * 2026-11-07): with no date it goes to the לשיבוץ list, with a date to the calendar.
 */
const missingOf = (job: PendingJob['job']): JobField[] => [
  ...(job.shiftKindId ? [] : (['shiftKindId'] as const)),
  ...(job.location || job.jobDescription ? [] : (['location'] as const)),
  ...(job.autoAssign && !job.date ? (['date'] as const) : []), // people are assigned only to a dated job
]

/** "תכניס לי עבודה", "עבודה חדשה", or the action words of a learned example. */
function jobSaid(f: Found, text: string, L: Learned): boolean {
  if (words(text).some((w) => OTHER_JOB.test(w))) return false
  const rest = f.rest.map(bare)
  if (said(L.job.words, rest.filter((w) => !ASSIGN.test(w)))) return true
  return words(text).some((w) => /^ו?עבוד[הת]$/.test(w)) && f.rest.some((w, k) => JOB_VERBS.has(w) || JOB_VERBS.has(rest[k]) || NEW_WORDS.has(w))
}
/** A word that belongs to "open a job" itself, not to its details. */
const isJobWord = (w: string, b: string, L: Learned) =>
  JOB_VERBS.has(w) || JOB_VERBS.has(b) || NEW_WORDS.has(b) || b === 'עבודה' || ASSIGN.test(b) || L.job.words.some((x) => x.includes(b))

/** A new job said the way a learned one was. */
function learnedJob(text: string, d: AppData, L: Learned, now: Date): Local {
  const f = find(text, d, L.aliases, now, L.protect)
  if (f.workerIds.length || f.unsure.length) return null // naming workers is beyond what was learned
  if (!jobSaid(f, text, L)) return null
  const rest = f.rest.map(bare)
  const unknownAt = f.restAt.filter((_, k) => !isJobWord(f.rest[k], rest[k], L))
  let description = f.description ?? ''
  if (unknownAt.length) {
    // Unexplained words are the description only when there is no known one, and they stand together.
    if (description || unknownAt.some((at, k) => k > 0 && at !== unknownAt[k - 1] + 1)) return null
    const ws = words(text)
    const run = unknownAt.map((at) => ws[at])
    // A question, another action or a bare number is not a description: Claude.
    if (run.some((w) => NOT_DESCRIPTION.test(w) || NOT_DESCRIPTION.test(bare(w)) || /^\d+$/.test(w))) return null
    description = run.join(' ')
  }
  // With one kind of job only, that is the kind.
  const kind = f.shiftKindId ?? (d.shiftDefinitions.length === 1 ? d.shiftDefinitions[0].id : '')
  const job = { date: f.date ?? '', shiftKindId: kind, location: f.location ?? '', jobDescription: description, staffing: f.staffing, autoAssign: rest.some((w) => ASSIGN.test(w)) }
  const missing = missingOf(job)
  if (missing.length) return { kind: 'ask', question: QUESTIONS[missing[0]](d), pending: { job, missing } }
  return { kind: 'propose', proposal: jobProposal(job, d, now) }
}

/** The answer to a question about a missing detail of a job being opened here. */
export function continueJob(text: string, p: PendingJob, d: AppData, L: Learned, now: Date): Local {
  const field = p.missing[0]
  const f = find(text, d, L.aliases, now, L.protect)
  const job = { ...p.job }
  if (f.workerIds.length || f.unsure.length) return null
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
  const missing = missingOf(job)
  if (missing.length && missing[0] === field) return null // the answer did not answer: Claude
  if (missing.length) return { kind: 'ask', question: QUESTIONS[missing[0]](d), pending: { job, missing } }
  return { kind: 'propose', proposal: jobProposal(job, d, now) }
}

/** "יוסי חולה היום", said the way a learned one was: mark sick, and offer a replacement when he is in a job. */
/** "<worker> חולה <when>": the change to his card and how it is said, or null when the sentence is more than that. */
export function sickPlan(text: string, d: AppData, L: Learned, now: Date): { workerId: string; extra: Edits; sickText: string; from: string; until: string } | null {
  const f = find(text, d, L.aliases, now, L.protect)
  if (f.workerIds.length !== 1 || f.location || f.staffing.length || f.shiftKindId || f.description) return null
  const rest = f.rest.map(bare)
  if (!said(L.sick.words, rest)) return null
  const action = new Set(L.sick.words.flat())
  if (rest.some((w) => !action.has(w))) return null
  if (L.sick.needsDate && !f.date) return null
  const today = plus(now, 0)
  const until = f.date ?? today
  if (until < today) return null
  // "חולה מחר" (a day ahead, not "עד מחר"): an absence on that day; he still works today.
  const ahead = until > today && !words(text).some((w) => /^ו?עד(?:-|$)/.test(w))
  const from = ahead ? until : today
  const w = d.workers.find((x) => x.id === f.workerIds[0])!
  const name = `${w.firstName} ${w.lastName}`.trim()
  const extra: Edits = {
    editJobs: [],
    setCrews: [],
    closeJobs: [],
    deleteJobIds: [],
    editWorkers: ahead ? [] : [{ workerId: w.id, mobilePhone: '', addRoleIds: [], removeRoleIds: [], addCertificationIds: [], removeCertificationIds: [], status: 'sick', sickUntil: until }],
    addConstraints: ahead ? [{ workerId: w.id, from: until, to: until, nightsOnly: false, note: 'מחלה', kind: '' }] : [],
  }
  const sickText = ahead ? `${name} חולה ${dayText(until, now)}` : `${name} חולה עד ${until === today ? 'היום' : dayText(until, now).replace(/^ביום /, 'יום ')}`
  return { workerId: w.id, extra, sickText, from, until }
}

/**
 * "<name> חולה" where the name is not one worker: about equally close to two or more, the app asks which;
 * close to none, it says there is no such worker (never a wild guess). Null when the sentence is more than that.
 */
function sickWho(text: string, d: AppData, L: Learned, now: Date): Local {
  const f = find(text, d, L.aliases, now, L.protect)
  if (f.workerIds.length || f.location || f.staffing.length || f.shiftKindId || f.description || f.unsure.length > 1) return null
  const rest = f.rest.map(bare)
  if (!said(L.sick.words, rest)) return null
  const action = new Set(L.sick.words.flat())
  const other = f.restAt.filter((_, k) => !action.has(rest[k]))
  const name = (id: string) => {
    const w = d.workers.find((x) => x.id === id)!
    return `${w.firstName} ${w.lastName}`.trim()
  }
  if (f.unsure.length === 1 && !other.length) {
    const u = f.unsure[0]
    const names = u.ids.map(name)
    const list = names.length === 2 ? names.join(' או ') : `${names.slice(0, -1).join(', ')} או ${names[names.length - 1]}`
    return { kind: 'which', question: `למי התכוונת, ${list}?`, pending: { text, at: u.at, n: u.n, ids: u.ids } }
  }
  if (!f.unsure.length && other.length === 1) {
    const heard = words(text)[other[0]]
    if (heard.length < 2 || COMMON.has(heard) || COMMON.has(bare(heard)) || isValue(heard)) return null
    return { kind: 'say', text: `לא מצאתי עובד בשם ${heard}. אפשר לומר שוב, עם השם כמו שהוא ברשימת העובדים.` }
  }
  return null
}

/** The answer to "למי התכוונת": the sentence again with the worker picked, or null when the answer is not one of them. */
export function continueWho(text: string, p: PendingWho, d: AppData, L: Learned, now: Date): { text: string; local: Local } | null {
  const ws = words(text)
  const options = p.ids.map((id) => d.workers.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => Boolean(x))
  let pick = isYes(clean(text)) ? null : pickedOption(text, options.length) // "כן" does not say which
  if (pick === null) {
    // A first name, a last name or both: the one option it fits, and only that one.
    const fits = options.map((w) => {
      const full = words(`${w.firstName} ${w.lastName}`)
      const meant = ws.filter((x) => !FILLER.has(x) && !/^(?:ל|את|כן|ה)$/.test(x))
      return meant.length > 0 && meant.every((x) => full.some((n) => closeName(x, n) || closeName(bare(x), n)))
    })
    const only = fits.filter(Boolean).length === 1 ? fits.indexOf(true) : -1
    // When the said words fit both, the closer last name decides.
    if (only < 0) {
      const scores = options.map((w) => Math.min(...ws.map((x) => nameDistance(x, w.lastName || ' '))))
      const best = Math.min(...scores)
      if (fits.every(Boolean) && scores.filter((x) => x === best).length === 1 && best <= 1) pick = scores.indexOf(best)
    } else pick = only
  }
  if (pick === null || pick < 0) return null
  const w = options[pick]
  const said1 = words(p.text)
  const fixed1 = [...said1.slice(0, p.at), w.firstName, ...(w.lastName ? [w.lastName] : []), ...said1.slice(p.at + p.n)].join(' ')
  // With the full name the sentence is about him alone (all workers stay in, as replacements).
  const local = handleFree(fixed1, d, L, now)
  return local ? { text: fixed1, local } : null
}

function learnedSick(text: string, d: AppData, L: Learned, now: Date): Local {
  const plan = sickPlan(text, d, L, now)
  if (!plan) return sickWho(text, d, L, now)
  const { extra, sickText, from, until } = plan
  const w = d.workers.find((x) => x.id === plan.workerId)!
  // Jobs he is in, from today to the last sick day.
  const jobs = d.shifts.filter((s) => !s.closure && s.date >= from && s.date <= until && s.crew.some((c) => c.workerId === w.id)).sort((a, b) => a.date.localeCompare(b.date))
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

/** Which of the offered solutions was picked by voice: "כן", "לעשות את זה", "הראשון", "פתרון 2", "את השלישי". Null if none. */
export function pickedOption(text: string, count: number): number | null {
  const t = clean(text).replace(/^(?:כן|טוב|אוקיי|יאללה)\s+/, '').replace(/^(?:את|תעשה את|לעשות את|תבחר את|בוא נעשה את)\s+/, '')
  if (isYes(t) || /^(?:(?:ת|ל)עשות?|תעשה|תבצע|לבצע)(?: את)? (?:זה|הפתרון הזה|ההמלצה)$/.test(t) || t === 'זה') return 0
  const ORD: [RegExp, number][] = [
    [/^(?:(?:ה)?פתרון |(?:ה)?אפשרות )?(?:ה)?(?:ראשון|ראשונה|1|אחד|אחת)$/, 0],
    [/^(?:(?:ה)?פתרון |(?:ה)?אפשרות )?(?:ה)?(?:שני|שנייה|שניה|2|שתיים)$/, 1],
    [/^(?:(?:ה)?פתרון |(?:ה)?אפשרות )?(?:ה)?(?:שלישי|שלישית|3|שלוש)$/, 2],
  ]
  for (const [re, i] of ORD) if (re.test(t) && i < count) return i
  return null
}

/** The first sentence of a conversation: handled here, or null for Claude. */
export function handleFree(text: string, d: AppData, L: Learned, now = new Date()): Local {
  return fixed(text, d, now) ?? learnedSick(text, d, L, now) ?? learnedJob(text, d, L, now)
}

// ---- Why a sentence went to Claude (the "what went to Claude" log, src/lib/claudeLog.ts) ----

/**
 * For a first sentence that handleFree did not do: why not, and what the free path did understand.
 * Written for the developer who reads the log and teaches the next action (skill free-commands), so in English.
 */
export function whyNotFree(text: string, d: AppData, L: Learned, now = new Date()): { reason: string; understood: string } {
  const f = find(text, d, L.aliases, now, L.protect)
  const rest = f.rest.map(bare)
  const q = (ws: string[]) => ws.map((w) => `"${w}"`).join(', ')
  const workerName = (id: string) => d.workers.find((x) => x.id === id)?.firstName ?? id
  const parts = [
    f.workerIds.length ? `workers: ${f.workerIds.map(workerName).join(', ')}` : '',
    f.unsure.length ? `names close to more than one worker: ${f.unsure.map((u) => u.ids.map(workerName).join('/')).join('; ')}` : '',
    f.date ? `date: ${f.date}` : '',
    f.location ? `place: ${f.location}` : '',
    f.shiftKindId ? `kind: ${d.shiftDefinitions.find((s) => s.id === f.shiftKindId)?.name ?? f.shiftKindId}` : '',
    f.staffing.length ? `roles: ${f.staffing.map((s) => `${s.count} ${d.roles.find((r) => r.id === s.roleId)?.name ?? s.roleId}`).join(', ')}` : '',
    f.description ? `job type: ${f.description}` : '',
    f.rest.length ? `not understood: ${q(f.rest)}` : '',
  ]
  const understood = parts.filter(Boolean).join('; ') || 'nothing'
  const out = (reason: string) => ({ reason, understood })
  const extra = (action: Set<string>) => f.rest.filter((_, k) => !action.has(rest[k]) && !ASSIGN.test(rest[k]))

  if (said(L.sick.words, rest)) {
    if (f.workerIds.length > 1 || f.unsure.length > 1) return out('sick: more than one worker named')
    if (f.location || f.staffing.length || f.shiftKindId || f.description) return out('sick: the sentence also has a place, role, job kind or job type')
    const more = extra(new Set(L.sick.words.flat()))
    if (more.length) return out(`sick: words not learned for sickness: ${q(more)}`)
    if (f.date && f.date < plus(now, 0)) return out('sick: the date is in the past')
    if (L.sick.needsDate && !f.date) return out('sick: no date said')
    return out('sick: not understood')
  }
  if (words(text).some((w) => OTHER_JOB.test(w))) return out('job: speaks of a job that exists ("העבודה") or of several jobs: changing jobs is not learned yet')
  if (jobSaid(f, text, L)) {
    if (f.workerIds.length || f.unsure.length) return out('job: names a worker (assigning a named worker is not learned yet)')
    const more = f.rest.filter((w, k) => !isJobWord(w, rest[k], L))
    if (f.description && more.length) return out(`job: words besides the known job type: ${q(more)}`)
    if (more.some((w) => NOT_DESCRIPTION.test(w) || NOT_DESCRIPTION.test(bare(w)))) return out(`job: a question or another action in it: ${q(more)}`)
    if (more.some((w) => /^\d+$/.test(w))) return out(`job: a number not tied to a known role or place: ${q(more)}`)
    return out(`job: unknown words not standing together: ${q(more)}`)
  }
  const learnedAs = `job (built-in verbs + ${L.job.words.length} examples), sick (${L.sick.words.length} phrasings)`
  return out(`no learned action matches (learned: ${learnedAs})`)
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
