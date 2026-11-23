// Masha7000 MCP write tools: add a job, change a job, add a waiting job, change a worker's status,
// add a constraint. Only through the existing write endpoints of /api/v1 (POST and PATCH, no deletes),
// and only with a key made with the "write" permission.
//
// Safety: every tool works in two steps. Without `confirm: true` it only returns a Hebrew preview of
// what would change, with warnings, and writes nothing. Claude shows the preview to the manager and
// calls again with `confirm: true` only after the manager said yes. Claude Code also asks before
// each tool call (its own permission prompt).
//
// Names, not ids: the manager says "יותם" or "לילה"; the tools find the id and refuse when a name
// fits nobody or more than one.
import { createHash } from 'node:crypto'
import { addDays, constraintOn, constraintWhy, isDate, jobOn, readablePending, readableShift } from './server.mjs'

const KIND_WORDS = { vacation: ['חופש', 'חופשה', 'vacation'], study: ['לימודים', 'study'], reserve: ['מילואים', 'reserve'], course: ['השתלמות', 'קורס', 'course'], sick: ['מחלה', 'sick'] }
const PART_WORDS = { morning: ['בוקר', 'morning'], noon: ['צהריים', 'noon'], evening: ['ערב', 'evening'] }
const STATUS_WORDS = { active: ['פעיל', 'בריא', 'active'], sick: ['חולה', 'sick'], inactive: ['לא פעיל', 'inactive'] }
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ')
const fullName = (w) => `${w.firstName} ${w.lastName}`.trim()

/** One item by name: exact name, then a name that starts with the words, then one that contains them. */
export function findByName(list, said, nameOf, what) {
  const want = clean(said)
  if (!want) throw new Error(`חסר ${what}`)
  const byId = list.find((x) => x.id === want)
  if (byId) return byId
  const tiers = [(n) => n === want, (n) => n.startsWith(`${want} `) || n === want, (n) => n.includes(want)]
  for (const fits of tiers) {
    const hits = list.filter((x) => fits(clean(nameOf(x))))
    if (hits.length === 1) return hits[0]
    if (hits.length > 1) throw new Error(`"${want}" מתאים ליותר מ${what} אחד: ${hits.map(nameOf).join(', ')}. צריך שם מלא.`)
  }
  throw new Error(`לא מצאתי ${what} בשם "${want}"${list.length ? `. יש: ${list.slice(0, 30).map(nameOf).join(', ')}` : ''}`)
}

const fromWords = (table, said, what) => {
  const want = clean(said).toLowerCase()
  const hit = Object.entries(table).find(([, words]) => words.includes(want))
  if (!hit) throw new Error(`${what} לא מוכר: "${said}". אפשר: ${Object.values(table).map((w) => w[0]).join(', ')}`)
  return hit[0]
}

/** API warnings (English, with ids) in the manager's words. */
export function hebrewWarning(text, workers) {
  const nameOfId = (id) => {
    const w = workers.find((x) => x.id === id)
    return w ? fullName(w) : 'עובד שנמחק'
  }
  let m
  if ((m = /^worker (\S+) is also in shift \S+ on (\S+)$/.exec(text))) return `${nameOfId(m[1])} כבר משובץ בעבודה אחרת ב-${m[2]}`
  if ((m = /^worker (\S+) is marked sick$/.exec(text))) return `${nameOfId(m[1])} מסומן חולה`
  if ((m = /^worker (\S+) in place \d+ lacks (.+)$/.exec(text))) return `ל${nameOfId(m[1])} חסרה הסמכה שהמקום דורש`
  if ((m = /^worker (\S+) is no longer in the workers list$/.exec(text))) return `עובד בצוות כבר לא ברשימת העובדים (${m[1]})`
  return text
}

/** Before writing: who in the crew is sick, busy elsewhere or has a constraint that day. */
export function crewProblems(crewIds, day, workers, shifts, exceptShiftId) {
  const out = []
  for (const id of crewIds) {
    const w = workers.find((x) => x.id === id)
    if (!w) continue
    const name = fullName(w)
    if (w.status === 'sick' && (!w.sickUntil || w.sickUntil >= day)) out.push(`${name} מסומן חולה${w.sickUntil ? ` עד ${w.sickUntil}` : ''}`)
    const other = shifts.find((s) => s.id !== exceptShiftId && jobOn(s, day) && s.crew.includes(id))
    if (other) out.push(`${name} כבר משובץ באותו יום: ${other.location || other.jobDescription}`)
    for (const c of w.constraints ?? []) {
      const hit = constraintOn(c, day)
      if (hit) out.push(`ל${name} יש אילוץ באותו יום: ${constraintWhy(c)}${hit === 'part' ? ' (חלק מהיום)' : ''}`)
    }
  }
  return out
}

const dayWords = (d) => `יום ${DAY_NAMES[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${Number(d.slice(8))}.${Number(d.slice(5, 7))}`
const needDate = (v, field) => {
  if (!isDate(v)) throw new Error(`${field} צריך להיות תאריך כמו 2026-11-24 (אפשר לקבל אותו מ-today)`)
  return v
}
const list = (v) => (v === undefined || v === null ? undefined : Array.isArray(v) ? v : [v])

const RULE = 'Never set confirm: true until the manager explicitly approved the latest read-back. After any correction, show the full new read-back again and wait for a new approval.'
const CONFIRM = { type: 'boolean', description: `false or missing = only a Hebrew read-back of the change (nothing is written). true = write it, together with changeCode from the read-back the manager approved. ${RULE}` }
const CODE = { type: 'string', description: 'changeCode from the approved read-back; needed with confirm: true. A different change gets a different code, so the write must be exactly what was approved.' }
/** A short code for one exact change: the same tool and the same body give the same code. */
export const changeCode = (tool, body) => createHash('sha256').update(JSON.stringify([tool, body])).digest('hex').slice(0, 10)
const NAMES = (what) => ({ type: 'array', items: { type: 'string' }, description: what })

/**
 * The write tools. `api` has get(path), named() and send(method, path, body) (see makeApi).
 * Each tool returns a preview without confirm, or the result after writing.
 */
export function makeWriteTools(api) {
  const people = () => api.get('workers?includeInactive=true')
  const activePeople = async () => (await people()).filter((w) => w.status !== 'inactive')
  const workerIds = (names, workers) => {
    const ids = (names ?? []).map((n) => findByName(workers, n, fullName, 'עובד').id)
    const twice = ids.find((id, i) => ids.indexOf(id) !== i)
    if (twice) throw new Error(`${fullName(workers.find((w) => w.id === twice))} מופיע פעמיים`)
    return ids
  }
  const preview = (tool, willDo, body, warnings = []) => ({
    preview: true,
    written: false,
    readBack: willDo,
    ...(warnings.length ? { warnings } : {}),
    changeCode: changeCode(tool, body),
    next: 'קרא למנהל את readBack ואת האזהרות במלואם, ושאל אם לבצע. רק אחרי שאישר במפורש: קרא שוב עם אותם פרטים, confirm: true ו-changeCode. אם תיקן משהו: קרא שוב בלי confirm והקרא את כל השינוי המעודכן מחדש.',
    change: body,
  })
  const gate = (tool, a, body) => {
    if (a.changeCode !== changeCode(tool, body)) throw new Error('לא כתבתי כלום: השינוי לא זהה למה שהמנהל אישר (או שחסר changeCode). קרא שוב בלי confirm, הקרא למנהל את השינוי המלא וחכה לאישור.')
  }
  const done = (result, warnings, workers) => ({ written: true, result, ...(warnings?.length ? { warnings: warnings.map((w) => hebrewWarning(w, workers)) } : {}) })

  return [
    {
      name: 'add_shift',
      description: 'Add a job to the calendar on a date: place, what to do, shift kind by name (יום/לילה...), crew by worker names, and optionally what each place needs (certification names). Two steps: first without confirm (a Hebrew read-back only, nothing written), then confirm: true with changeCode. ' + RULE,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          location: { type: 'string', description: 'the place, e.g. חולון' },
          job: { type: 'string', description: 'what to do there' },
          kind: { type: 'string', description: 'shift kind name, e.g. יום or לילה' },
          crew: NAMES('worker names to put in the job'),
          needs: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'one entry per place in the crew: certification names that place needs ([] = anyone)' },
          confirm: CONFIRM,
          changeCode: CODE,
        },
        required: ['date'],
      },
      run: async (a) => {
        const day = needDate(a.date, 'date')
        if (!clean(a.location) && !clean(a.job)) throw new Error('צריך מקום או תיאור עבודה')
        const [workers, lists, sameDay] = await Promise.all([activePeople(), api.named(), api.get(`shifts?from=${addDays(day, -14)}&to=${day}`)])
        const crew = workerIds(list(a.crew), workers)
        const kind = a.kind ? findByName(lists.kinds, a.kind, (k) => k.name, 'סוג משמרת').id : undefined
        const needs = list(a.needs)?.map((slot) => ({ certificationIds: (list(slot) ?? []).map((c) => findByName(lists.certs, c, (x) => x.name, 'הסמכה').id) }))
        const body = { date: day, ...(clean(a.location) ? { location: clean(a.location) } : {}), ...(clean(a.job) ? { jobDescription: clean(a.job) } : {}), ...(kind ? { shiftKindId: kind } : {}), crew, ...(needs ? { staffing: needs } : {}) }
        if (a.confirm !== true) {
          const who = crew.map((id) => fullName(workers.find((w) => w.id === id)))
          const willDo = `להוסיף עבודה ב${dayWords(day)}${kind ? ` (${lists.kinds.find((k) => k.id === kind).name})` : ''}: ${[body.location, body.jobDescription].filter(Boolean).join(' - ')}. צוות: ${who.length ? who.join(', ') : 'עוד אין'}.`
          return preview('add_shift', willDo, body, crewProblems(crew, day, workers, sameDay))
        }
        gate('add_shift', a, body)
        const { data, warnings } = await api.send('POST', 'shifts', body)
        return done(readableShift(data, { workers, ...lists }), warnings, workers)
      },
    },
    {
      name: 'update_shift',
      description: 'Change a job already in the calendar (its id comes from get_shifts): move it to another date, change place, job text or kind, add or remove crew members by name, or set the whole crew. Two steps: read-back, then confirm: true with changeCode. ' + RULE,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          shiftId: { type: 'string', description: 'the job id from get_shifts' },
          date: { type: 'string', description: 'new date, YYYY-MM-DD' },
          location: { type: 'string' },
          job: { type: 'string' },
          kind: { type: 'string', description: 'shift kind name' },
          addWorkers: NAMES('worker names to add to the crew'),
          removeWorkers: NAMES('worker names to take out of the crew'),
          crew: NAMES('the whole new crew (instead of add/remove)'),
          confirm: CONFIRM,
          changeCode: CODE,
        },
        required: ['shiftId'],
      },
      run: async (a) => {
        if (!clean(a.shiftId)) throw new Error('חסר מזהה עבודה (shiftId מ-get_shifts)')
        const [old, workers, lists] = await Promise.all([api.get(`shifts/${encodeURIComponent(clean(a.shiftId))}`), people(), api.named()])
        const active = workers.filter((w) => w.status !== 'inactive')
        const body = {}
        if (a.date !== undefined && a.date !== old.date) body.date = needDate(a.date, 'date')
        if (a.location !== undefined) body.location = clean(a.location)
        if (a.job !== undefined) body.jobDescription = clean(a.job)
        if (a.kind !== undefined) body.shiftKindId = clean(a.kind) ? findByName(lists.kinds, a.kind, (k) => k.name, 'סוג משמרת').id : null
        let crew = old.crew
        if (a.crew !== undefined) crew = workerIds(list(a.crew), active)
        else if (a.addWorkers !== undefined || a.removeWorkers !== undefined) {
          const out = (list(a.removeWorkers) ?? []).map((n) => findByName(workers.filter((w) => old.crew.includes(w.id)), n, fullName, 'עובד בצוות של העבודה').id)
          const add = workerIds(list(a.addWorkers), active).filter((id) => !old.crew.includes(id))
          crew = [...old.crew.filter((id) => !out.includes(id)), ...add]
        }
        const crewChanged = crew.length !== old.crew.length || crew.some((id, i) => id !== old.crew[i])
        if (crewChanged) {
          body.crew = crew
          const pinned = old.pinnedWorkerIds.filter((id) => crew.includes(id))
          if (pinned.length !== old.pinnedWorkerIds.length) body.pinnedWorkerIds = pinned
        }
        if (!Object.keys(body).length) throw new Error('אין מה לשנות: הפרטים שנשלחו זהים למה שכבר יש')
        if (a.confirm !== true) {
          const day = body.date ?? old.date
          const sameDay = await api.get(`shifts?from=${addDays(day, -14)}&to=${day}`)
          const nameOf = (id) => fullName(workers.find((w) => w.id === id) ?? { firstName: id, lastName: '' })
          const changes = [
            body.date ? `תאריך: ${dayWords(old.date)} ← ${dayWords(body.date)}` : null,
            'location' in body ? `מקום: ${old.location || '(ריק)'} ← ${body.location || '(ריק)'}` : null,
            'jobDescription' in body ? `עבודה: ${old.jobDescription || '(ריק)'} ← ${body.jobDescription || '(ריק)'}` : null,
            'shiftKindId' in body ? `סוג: ${body.shiftKindId ? lists.kinds.find((k) => k.id === body.shiftKindId).name : 'בלי'}` : null,
            ...crew.filter((id) => !old.crew.includes(id)).map((id) => `נכנס לצוות: ${nameOf(id)}`),
            ...old.crew.filter((id) => !crew.includes(id)).map((id) => `יוצא מהצוות: ${nameOf(id)}`),
          ].filter(Boolean)
          const newcomers = body.date ? crew : crew.filter((id) => !old.crew.includes(id))
          return preview('update_shift', `לשנות את העבודה ${[old.location, old.jobDescription].filter(Boolean).join(' - ')} (${dayWords(old.date)}): ${changes.join('; ')}.`, body, crewProblems(newcomers, day, workers, sameDay, old.id))
        }
        gate('update_shift', a, body)
        const { data, warnings } = await api.send('PATCH', `shifts/${encodeURIComponent(old.id)}`, body)
        return done(readableShift(data, { workers, ...lists }), warnings, workers)
      },
    },
    {
      name: 'add_pending_job',
      description: 'Add a job to the waiting list (no date yet): place, what to do, kind by name, an optional note. Two steps: read-back, then confirm: true with changeCode. ' + RULE,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: { location: { type: 'string' }, job: { type: 'string' }, kind: { type: 'string', description: 'shift kind name' }, note: { type: 'string' }, confirm: CONFIRM, changeCode: CODE },
      },
      run: async (a) => {
        if (!clean(a.location) && !clean(a.job)) throw new Error('צריך מקום או תיאור עבודה')
        const lists = await api.named()
        const kind = a.kind ? findByName(lists.kinds, a.kind, (k) => k.name, 'סוג משמרת').id : undefined
        const body = { ...(clean(a.location) ? { location: clean(a.location) } : {}), ...(clean(a.job) ? { jobDescription: clean(a.job) } : {}), ...(kind ? { shiftKindId: kind } : {}), ...(clean(a.note) ? { note: clean(a.note) } : {}) }
        if (a.confirm !== true) return preview('add_pending_job', `להוסיף לרשימת העבודות שמחכות לשיבוץ: ${[body.location, body.jobDescription].filter(Boolean).join(' - ')}${kind ? ` (${lists.kinds.find((k) => k.id === kind).name})` : ''}.`, body)
        gate('add_pending_job', a, body)
        const { data, warnings } = await api.send('POST', 'pending-jobs', body)
        return done(readablePending(data, lists), warnings, [])
      },
    },
    {
      name: 'set_worker_status',
      description: 'Mark a worker (by name) as sick until a date, back to active, or not active any more. Two steps: read-back, then confirm: true with changeCode. ' + RULE,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          worker: { type: 'string', description: 'worker name' },
          status: { type: 'string', description: 'חולה / פעיל / לא פעיל' },
          sickUntil: { type: 'string', description: 'last sick day, YYYY-MM-DD (needed with חולה)' },
          confirm: CONFIRM,
          changeCode: CODE,
        },
        required: ['worker', 'status'],
      },
      run: async (a) => {
        const workers = await people()
        const w = findByName(workers, a.worker, fullName, 'עובד')
        const status = fromWords(STATUS_WORDS, a.status, 'מצב')
        const body = { status, ...(status === 'sick' ? { sickUntil: needDate(a.sickUntil, 'sickUntil') } : {}) }
        if (a.confirm !== true) {
          const words = status === 'sick' ? `חולה עד ${dayWords(body.sickUntil)}` : status === 'active' ? 'פעיל' : 'לא פעיל (לא יופיע ברשימות)'
          let warnings = []
          if (status !== 'active') {
            const t = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' })
            const until = status === 'sick' ? body.sickUntil : addDays(t, 60)
            if (until >= t) {
              const jobs = (await api.get(`shifts?from=${t}&to=${until}`)).filter((s) => s.crew.includes(w.id))
              warnings = jobs.map((s) => `${fullName(w)} משובץ ב${dayWords(s.date)}: ${s.location || s.jobDescription}. הסימון לא מוציא אותו מהעבודה.`)
            }
          }
          return preview('set_worker_status', `לסמן את ${fullName(w)} כ${words}.`, body, warnings)
        }
        gate('set_worker_status', a, body)
        const { data, warnings } = await api.send('PATCH', `workers/${encodeURIComponent(w.id)}`, body)
        return done({ name: fullName(data), status: data.status, ...(data.sickUntil ? { sickUntil: data.sickUntil } : {}) }, warnings, workers)
      },
    },
    {
      name: 'add_constraint',
      description: "Add a constraint to a worker (by name): dates (from-to) or fixed weekdays or always; optional kind (חופש, מחלה, מילואים, לימודים, השתלמות), nights only, or part of the day (בוקר/צהריים/ערב). Two steps: read-back, then confirm: true with changeCode. " + RULE,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          worker: { type: 'string', description: 'worker name' },
          from: { type: 'string', description: 'first day, YYYY-MM-DD' },
          to: { type: 'string', description: 'last day, YYYY-MM-DD (missing = one day)' },
          weekdays: { type: 'array', items: { type: 'string' }, description: 'fixed days instead of dates, e.g. ["שלישי"]' },
          always: { type: 'boolean', description: 'every day, no end' },
          kind: { type: 'string', description: 'חופש / מחלה / מילואים / לימודים / השתלמות (missing = an ordinary constraint)' },
          nightsOnly: { type: 'boolean', description: 'only no nights' },
          part: { type: 'string', description: 'בוקר / צהריים / ערב (missing = the whole day)' },
          note: { type: 'string' },
          confirm: CONFIRM,
          changeCode: CODE,
        },
        required: ['worker'],
      },
      run: async (a) => {
        const workers = await activePeople()
        const w = findByName(workers, a.worker, fullName, 'עובד')
        const body = {}
        if (a.always === true) body.when = 'always'
        else if (list(a.weekdays)?.length) {
          body.when = 'weekdays'
          body.weekdays = list(a.weekdays).map((d) => {
            const i = DAY_NAMES.findIndex((n) => n === clean(d).replace(/^יום /, ''))
            if (i < 0) throw new Error(`יום לא מוכר: "${d}". אפשר: ${DAY_NAMES.join(', ')}`)
            return i
          })
        } else {
          body.when = 'dates'
          body.from = needDate(a.from, 'from')
          if (a.to !== undefined && a.to !== a.from) body.to = needDate(a.to, 'to')
        }
        if (a.kind) body.kind = fromWords(KIND_WORDS, a.kind, 'סוג אילוץ')
        if (a.nightsOnly === true) body.nightsOnly = true
        if (a.part) body.part = fromWords(PART_WORDS, a.part, 'חלק ביום')
        if (clean(a.note)) body.note = clean(a.note)
        if (a.confirm !== true) {
          const when = body.when === 'always' ? 'תמיד' : body.when === 'weekdays' ? `כל ${body.weekdays.map((d) => `יום ${DAY_NAMES[d]}`).join(', ')}` : body.to ? `מ${dayWords(body.from)} עד ${dayWords(body.to)}` : `ב${dayWords(body.from)}`
          let warnings = []
          if (body.when === 'dates') {
            const jobs = (await api.get(`shifts?from=${body.from}&to=${body.to ?? body.from}`)).filter((s) => s.crew.includes(w.id))
            warnings = jobs.map((s) => `${fullName(w)} כבר משובץ ב${dayWords(s.date)}: ${s.location || s.jobDescription}. האילוץ לא מוציא אותו מהעבודה.`)
          }
          return preview('add_constraint', `להוסיף ל${fullName(w)} אילוץ: ${constraintWhy({ ...body, kind: body.kind ?? null })}, ${when}.`, body, warnings)
        }
        gate('add_constraint', a, body)
        const { data, warnings } = await api.send('POST', `workers/${encodeURIComponent(w.id)}/constraints`, body)
        return done({ worker: fullName(w), why: constraintWhy(data), when: data.when, from: data.from, to: data.to, weekdays: data.weekdays }, warnings, workers)
      },
    },
  ]
}
