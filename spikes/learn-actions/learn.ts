// Spike: can Shali learn from what Claude did (a confirmed proposal) how to do the same kind of action
// alone next time, with other details? Throwaway. Only "new job" is tried: the hardest common action.
//
// Idea: in every sentence Shali can already find the things it knows by name (days, kinds of job,
// places, roles with a count, workers), because they are in its own lists. What is left are the
// "action words" ("תפתח עבודה", "תשבץ"). From each confirmed example it keeps:
//   - the action words of that request (what makes it a "new job" request),
//   - new words Claude understood that the lists do not have (an alias: "מטפסים" = role טפסן),
//   - which fields the action needs (the fields every example filled), to ask for what is missing.
// A new sentence is handled alone only when its action words are close to a learned example's and
// nothing in it is left unexplained; otherwise it goes to Claude.

export interface Lists {
  roles: { id: string; name: string }[]
  workers: { id: string; firstName: string; lastName: string }[]
  shiftDefinitions: { id: string; name: string; thenJob?: boolean }[]
  places: { id: string; name: string }[]
  jobTypes: { id: string; name: string }[]
}

export interface Job {
  date: string
  shiftKindId: string
  location: string
  jobDescription: string
  staffing: { roleId: string; count: number }[]
  autoAssign: boolean
}

export interface Example {
  said: string // everything the manager said in that conversation, in order
  job: Job // what he confirmed
}

export interface Learned {
  actions: { words: string[]; autoAssign: boolean }[]
  aliases: Record<string, string> // word -> roleId
  required: (keyof Job)[]
}

export type Outcome =
  | { kind: 'job'; job: Job }
  | { kind: 'ask'; missing: (keyof Job)[]; partial: Partial<Job> }
  | { kind: 'claude'; why: string }

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
const NUMBERS: Record<string, number> = {
  אחד: 1, אחת: 1, שניים: 2, שני: 2, שתיים: 2, שתי: 2, שלושה: 3, שלוש: 3, שלושת: 3, ארבעה: 4, ארבע: 4, חמישה: 5, חמש: 5,
}
// Small words that carry no meaning here.
const FILLER = new Set(['לי', 'את', 'עם', 'של', 'גם', 'ו', 'אני', 'צריך', 'רוצה', 'בבקשה', 'יש', 'עוד', 'כולל', 'אתר', 'ה', 'אחד', 'אחת'])

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const plus = (now: Date, n: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n))

const words = (s: string) => s.replace(/[?!.,״"׳:;]/g, ' ').split(/\s+/).filter(Boolean)
/** A word without a leading ב/ל/ו/ה (one letter), for matching names: "באילת" -> "אילת". */
const bare = (w: string) => w.replace(/^(?:ו?[בלה]|ו)(?=.{2,})/, '')
const singular = (w: string) => w.replace(/(?:ים|ות)$/, '').replace(/א$/, 'אי') // חשמלאים -> חשמלאי

interface Found {
  date?: string
  shiftKindId?: string
  location?: string
  staffing: { roleId: string; count: number }[]
  description?: string
  rest: string[] // words not explained: action words, or unknown things
}

/** Everything in the sentence that the lists explain. */
export function find(said: string, lists: Lists, aliases: Record<string, string>, now: Date): Found {
  const ws = words(said)
  const used = new Array(ws.length).fill(false)
  const out: Found = { staffing: [], rest: [] }
  const take = (i: number, n = 1) => {
    for (let k = i; k < i + n; k++) used[k] = true
  }

  // Places: a known place name (all its words in a row, the first maybe with ב).
  for (const p of lists.places) {
    const pw = words(p.name)
    for (let i = 0; i + pw.length <= ws.length; i++) {
      if (pw.every((w, k) => (k === 0 ? bare(ws[i]) === w || ws[i] === w : ws[i + k] === w))) {
        out.location = p.name
        take(i, pw.length)
      }
    }
  }
  // Kinds of job: "לינה", "כולל לינה", "עבודת לילה", "יום".
  for (let i = 0; i < ws.length; i++) {
    if (used[i]) continue
    const w = bare(ws[i])
    const def = lists.shiftDefinitions.find((d) => d.name === w || d.name === ws[i])
    if (def && !(def.name === 'יום' && DAYS.includes(bare(ws[i + 1] ?? '')))) {
      out.shiftKindId = def.id
      take(i)
      if (i > 0 && /^(?:עבודת|כולל|עם)$/.test(ws[i - 1])) take(i - 1)
    }
  }
  // Dates.
  for (let i = 0; i < ws.length; i++) {
    if (used[i]) continue
    const w = ws[i]
    if (w === 'היום') (out.date = plus(now, 0)), take(i)
    else if (w === 'מחר') (out.date = plus(now, 1)), take(i)
    else if (w === 'מחרתיים') (out.date = plus(now, 2)), take(i)
    else {
      const day = DAYS.indexOf(bare(w.replace(/^ביום$|^יום$/, '')))
      const isDayWord = /^(?:ב|ל)?יום$/.test(w) && DAYS.includes(bare(ws[i + 1] ?? ''))
      if (isDayWord) continue
      // "שני" as a count ("שני מטפסים") is not a day: a day follows "יום"/ב or stands before הקרוב/הבא.
      const prev = ws[i - 1] ?? ''
      const next = ws[i + 1] ?? ''
      if (day >= 0 && (/^(?:ב|ל)?יום$/.test(prev) || /^[בל]/.test(w) || /^(?:הקרוב|הבא)$/.test(next))) {
        const ahead = (day - now.getDay() + 7) % 7 || 7
        out.date = plus(now, ahead)
        take(i)
        if (/^(?:ב|ל)?יום$/.test(prev)) take(i - 1)
        if (/^(?:הקרוב|הבא)$/.test(next)) take(i + 1)
      }
    }
  }
  // Roles with a count: "שני מטפסים", "טכנאי מצלמות אחד", "חשמלאי".
  const roleAt = (i: number): [string, number] | null => {
    for (const r of lists.roles) {
      const rw = words(r.name)
      if (rw.every((w, k) => singular(bare(ws[i + k] ?? '')) === singular(w) || bare(ws[i + k] ?? '') === w)) return [r.id, rw.length]
    }
    const alias = aliases[singular(bare(ws[i] ?? ''))]
    return alias ? [alias, 1] : null
  }
  for (let i = 0; i < ws.length; i++) {
    if (used[i]) continue
    const r = roleAt(i)
    if (!r) continue
    let count = 1
    if (i > 0 && !used[i - 1] && (NUMBERS[ws[i - 1]] || /^\d$/.test(ws[i - 1]))) count = NUMBERS[ws[i - 1]] ?? Number(ws[i - 1]), take(i - 1)
    else if (NUMBERS[ws[i + r[1]] ?? '']) count = NUMBERS[ws[i + r[1]]], take(i + r[1])
    out.staffing.push({ roleId: r[0], count })
    take(i, r[1])
  }
  // Job description: a known job type.
  for (const j of lists.jobTypes) {
    const jw = words(j.name)
    for (let i = 0; i + jw.length <= ws.length; i++) {
      if (jw.every((w, k) => ws[i + k] === w)) (out.description = j.name), take(i, jw.length)
    }
  }
  out.rest = ws.filter((_, i) => !used[i]).filter((w) => !FILLER.has(w))
  return out
}


/** Learn from confirmed examples: action words, aliases, required fields. */
export function learn(examples: Example[], lists: Lists, now: Date): Learned {
  const learned: Learned = { actions: [], aliases: {}, required: [] }
  for (const ex of examples) {
    const f = find(ex.said, lists, learned.aliases, now)
    let rest = f.rest
    // A role Claude put in the job that Shali did not find: the leftover word before/after a count is its name.
    for (const s of ex.job.staffing) {
      if (f.staffing.some((x) => x.roleId === s.roleId)) continue
      const ws = words(ex.said)
      const i = ws.findIndex((w, k) => NUMBERS[ws[k - 1] ?? ''] === s.count && rest.includes(w))
      if (i >= 0) {
        learned.aliases[singular(bare(ws[i]))] = s.roleId
        rest = rest.filter((w) => w !== ws[i])
      }
    }
    // With the new aliases the count words are explained too.
    rest = rest.filter((w) => find(ex.said, lists, learned.aliases, now).rest.includes(w))
    // The description, if it is free text: its words are not action words.
    const desc = words(ex.job.jobDescription)
    rest = rest.filter((w) => !desc.includes(w))
    learned.actions.push({ words: rest.map(bare), autoAssign: ex.job.autoAssign })
  }
  const fields: (keyof Job)[] = ['date', 'shiftKindId', 'location', 'jobDescription', 'staffing']
  learned.required = fields.filter((k) => examples.every((e) => (Array.isArray(e.job[k]) ? (e.job[k] as unknown[]).length > 0 : Boolean(e.job[k]))))
  return learned
}

// Words that mean "assign people too".
const ASSIGN = /^(?:ו?תשבץ|ו?שבץ|ו?תשבצי|מישהו|אנשים)$/

/** A new sentence: a job made alone, a question for a missing detail, or Claude. */
export function handle(said: string, learned: Learned, lists: Lists, now: Date): Outcome {
  const f = find(said, lists, learned.aliases, now)
  const restBare = f.rest.map(bare)
  // Every action word of a learned example must be said ("תפתח עבודה"); a different verb is a different action.
  const has = (a: { words: string[] }) => a.words.filter((w) => !ASSIGN.test(w)).every((w) => restBare.includes(w))
  const best = learned.actions.some(has) ? 1 : 0
  if (best < 1) return { kind: 'claude', why: `not a learned action (${restBare.join(' ')})` }
  // What is left after the action words must be the description, and only when no known job type was found.
  const actionWords = new Set(learned.actions.flatMap((a) => a.words))
  const unknown = f.rest.filter((w) => !actionWords.has(bare(w)) && !ASSIGN.test(bare(w)))
  let description = f.description ?? ''
  if (unknown.length) {
    if (description) return { kind: 'claude', why: `unexplained words: ${unknown.join(' ')}` }
    description = unknown.join(' ')
  }
  // A name of a worker is beyond this action: Claude.
  if (f.rest.some((w) => lists.workers.some((x) => bare(w) === x.firstName))) return { kind: 'claude', why: 'names a worker' }
  const job: Job = {
    date: f.date ?? '',
    shiftKindId: f.shiftKindId ?? '',
    location: f.location ?? '',
    jobDescription: description,
    staffing: f.staffing,
    autoAssign: f.rest.some((w) => ASSIGN.test(bare(w))),
  }
  const missing = learned.required.filter((k) => (Array.isArray(job[k]) ? (job[k] as unknown[]).length === 0 : !job[k]))
  return missing.length ? { kind: 'ask', missing, partial: job } : { kind: 'job', job }
}
