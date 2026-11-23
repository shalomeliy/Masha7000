#!/usr/bin/env node
// Masha7000 MCP server: lets Claude (Claude Code on the owner's PC, via .mcp.json) read the shift
// calendar through the outside API (/api/v1). READ ONLY: it only ever sends GET, so it cannot change
// anything in the app. A key without personal details is enough (no phones or ID numbers reach Claude).
// No dependencies: MCP over stdio is newline-delimited JSON-RPC 2.0. Docs: docs/mcp.md.
//
// Env: MASHA_API_KEY (Settings > נתונים וגוגל > גישת API), MASHA_API_URL (default: the live app).
import { createInterface } from 'node:readline'

const BASE = (process.env.MASHA_API_URL || 'https://masha7000.vercel.app/api/v1').replace(/\/$/, '')
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const LISTS_TTL_MS = 5 * 60_000
const PARTS = { morning: 'בוקר', noon: 'צהריים', evening: 'ערב', night: 'לילה' }
const KINDS = { vacation: 'חופש', study: 'לימודים', reserve: 'מילואים', course: 'השתלמות', sick: 'מחלה' }

// ---- pure helpers (tested in server.test.ts) ----

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
const weekday = (d) => new Date(`${d}T12:00:00Z`).getUTCDay()
const fullName = (w) => `${w.firstName} ${w.lastName}`.trim()
const nameOf = (list, id) => list.find((x) => x.id === id)?.name ?? id

/** Does a constraint hit this day? 'all' = the whole day, 'part' = only nights or part of the day, null = no. */
export function constraintOn(c, day) {
  const hits =
    c.when === 'always' ||
    (c.when === 'weekdays' && c.weekdays.includes(weekday(day))) ||
    (c.when === 'dates' && !!c.from && day >= c.from && day <= (c.to || c.from))
  if (!hits) return null
  return c.nightsOnly || c.part ? 'part' : 'all'
}

/** Why a constraint blocks, in Hebrew words the manager uses. */
export function constraintWhy(c) {
  if (c.kind && KINDS[c.kind]) return KINDS[c.kind]
  if (c.nightsOnly) return 'לא בלילות'
  if (c.part && PARTS[c.part]) return `לא ב${PARTS[c.part]}`
  return 'אילוץ'
}

/** The worker's certifications still valid on that day, by name. */
export function certsOn(w, day, certs) {
  return w.certifications.filter((c) => !c.validUntil || c.validUntil >= day).map((c) => nameOf(certs, c.id))
}

/** Is a job on (or over) this day? */
export const jobOn = (s, day) => s.date === day || (!!s.endDate && s.date < day && s.endDate >= day)

/** Who can work on a day: free, partly free (night-only or part-of-day constraint), and who is not free and why. */
export function freeOn(day, workers, shifts, certs = []) {
  const busy = new Map()
  for (const s of shifts.filter((x) => jobOn(x, day))) for (const id of s.crew) busy.set(id, s.location || s.jobDescription)
  const free = []
  const partlyFree = []
  const notFree = []
  for (const w of workers) {
    if (w.status === 'inactive') continue
    const name = fullName(w)
    if (w.status === 'sick' && (!w.sickUntil || w.sickUntil >= day)) {
      notFree.push({ name, why: w.sickUntil ? `חולה עד ${w.sickUntil}` : 'חולה' })
      continue
    }
    if (busy.has(w.id)) {
      notFree.push({ name, why: `משובץ בעבודה: ${busy.get(w.id)}` })
      continue
    }
    const hits = w.constraints.map((c) => [c, constraintOn(c, day)]).filter(([, m]) => m)
    const whole = hits.find(([, m]) => m === 'all')
    if (whole) {
      notFree.push({ name, why: constraintWhy(whole[0]) })
      continue
    }
    const entry = { id: w.id, name, certifications: certsOn(w, day, certs) }
    if (hits.length) partlyFree.push({ ...entry, limits: hits.map(([c]) => constraintWhy(c)) })
    else free.push(entry)
  }
  return { date: day, free, partlyFree, notFree }
}

/** A job with names instead of ids. */
export function readableShift(s, { workers, certs, kinds, workKinds }) {
  const person = (id) => {
    const w = workers.find((x) => x.id === id)
    return w ? fullName(w) : `(עובד שנמחק ${id})`
  }
  const missing = Math.max(0, s.staffing.length - s.crew.length)
  return {
    id: s.id,
    date: s.date,
    ...(s.endDate && s.endDate !== s.date ? { endDate: s.endDate } : {}),
    kind: s.shiftKindId ? nameOf(kinds, s.shiftKindId) : null,
    location: s.location,
    job: s.jobDescription,
    crew: s.crew.map(person),
    needs: s.staffing.map((slot) => [...slot.certificationIds.map((c) => nameOf(certs, c)), ...(slot.workKindId ? [nameOf(workKinds, slot.workKindId)] : [])].join(', ') || 'ללא'),
    missing,
    ...(s.urgent ? { urgent: true } : {}),
    ...(s.closure ? { closed: s.closure.outcome } : {}),
  }
}

/** A waiting job with names instead of ids. */
export function readablePending(j, { certs, kinds, workKinds }) {
  return {
    id: j.id,
    location: j.location,
    job: j.jobDescription,
    kind: j.shiftKindId ? nameOf(kinds, j.shiftKindId) : null,
    needs: j.staffing.map((slot) => [...slot.certificationIds.map((c) => nameOf(certs, c)), ...(slot.workKindId ? [nameOf(workKinds, slot.workKindId)] : [])].join(', ') || 'ללא'),
    createdAt: j.createdAt,
  }
}

/** A worker as Claude needs it: name, status, certifications with stars and expiry, constraints in words. */
export function readableWorker(w, { certs, departments }) {
  return {
    id: w.id,
    name: fullName(w),
    status: w.status === 'sick' ? (w.sickUntil ? `חולה עד ${w.sickUntil}` : 'חולה') : w.status === 'inactive' ? 'לא פעיל' : 'פעיל',
    department: w.departmentId ? nameOf(departments, w.departmentId) : null,
    certifications: w.certifications.map((c) => ({ name: nameOf(certs, c.id), stars: c.stars, ...(c.validUntil ? { validUntil: c.validUntil } : {}) })),
    constraints: w.constraints.map((c) => ({
      why: constraintWhy(c),
      ...(c.when === 'dates' ? { from: c.from, to: c.to || c.from } : c.when === 'weekdays' ? { weekdays: c.weekdays } : { always: true }),
    })),
  }
}

/** Adds days to YYYY-MM-DD. */
export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ---- the API ----

export function makeApi(key = process.env.MASHA_API_KEY || '', base = BASE, fetchFn = fetch) {
  let lists = null
  let listsAt = 0
  async function get(path) {
    if (!key) throw new Error('MASHA_API_KEY is not set. Make a read-only key in Settings > נתונים וגוגל > גישת API and save it with: setx MASHA_API_KEY <key>')
    let res
    try {
      res = await fetchFn(`${base}/${path}`, { headers: { Authorization: `Bearer ${key}` } })
    } catch (e) {
      throw new Error(`cannot reach the Masha7000 API (${e.message})`)
    }
    const body = await res.json().catch(() => null)
    if (res.status === 401 || res.status === 403) throw new Error('the API key was refused (deleted or wrong). Make a new one in Settings > גישת API.')
    if (!res.ok || !body || body.error) throw new Error(`API ${res.status}: ${body?.error?.message ?? body?.error?.code ?? 'no answer'}`)
    return body.data
  }
  async function named() {
    if (!lists || Date.now() - listsAt > LISTS_TTL_MS) {
      const [certs, kinds, departments, workKinds] = await Promise.all(['certifications', 'shift-kinds', 'departments', 'work-kinds'].map(get))
      lists = { certs, kinds, departments, workKinds }
      listsAt = Date.now()
    }
    return lists
  }
  return { get, named }
}

// ---- tools ----

const dateArg = (description) => ({ type: 'string', description: `${description} (YYYY-MM-DD)` })

export function makeTools(api, today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' })) {
  const need = (v, field) => {
    if (!isDate(v)) throw new Error(`${field} must be a date like 2026-11-24`)
    return v
  }
  return [
    {
      name: 'today',
      description: "Today's date in Israel and the next 14 days with weekday names. Call it first to turn words like 'מחר' or 'יום שלישי' into a date.",
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const t = today()
        const names = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
        return { today: t, days: Array.from({ length: 15 }, (_, i) => ({ date: addDays(t, i), weekday: names[weekday(addDays(t, i))] })) }
      },
    },
    {
      name: 'get_shifts',
      description: 'Jobs in the calendar between two dates (inclusive, at most 366 days): date, kind (day/night...), place, job, crew names, needs per place, how many are missing.',
      inputSchema: { type: 'object', properties: { from: dateArg('first day'), to: dateArg('last day') }, required: ['from', 'to'] },
      run: async ({ from, to }) => {
        need(from, 'from')
        need(to, 'to')
        const [shifts, workers, lists] = await Promise.all([api.get(`shifts?from=${from}&to=${to}`), api.get('workers?includeInactive=true'), api.named()])
        return shifts.map((s) => readableShift(s, { workers, ...lists }))
      },
    },
    {
      name: 'who_is_free',
      description: 'Who can work on a day: free (with valid certifications), partly free (night-only or part-of-day limits), and who is not free and why (sick, vacation, already in a job...).',
      inputSchema: { type: 'object', properties: { date: dateArg('the day') }, required: ['date'] },
      run: async ({ date }) => {
        need(date, 'date')
        const [workers, shifts, lists] = await Promise.all([api.get('workers'), api.get(`shifts?from=${addDays(date, -14)}&to=${date}`), api.named()])
        return freeOn(date, workers, shifts, lists.certs)
      },
    },
    {
      name: 'get_workers',
      description: 'Active workers: name, status, department, certifications with stars (1-5) and expiry, constraints in words. No phone or ID numbers.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const [workers, lists] = await Promise.all([api.get('workers'), api.named()])
        return workers.map((w) => readableWorker(w, lists))
      },
    },
    {
      name: 'get_pending_jobs',
      description: 'Jobs waiting to be scheduled (no date yet): place, job, kind, needs.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const [jobs, lists] = await Promise.all([api.get('pending-jobs?waiting=true'), api.named()])
        return jobs.map((j) => readablePending(j, lists))
      },
    },
  ]
}

// ---- the MCP protocol ----

export function makeHandler(tools) {
  return async function handle(msg) {
    const { id, method, params } = msg
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion
        return {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'masha7000', version: '1.0.0' },
          instructions: 'Read-only access to the Masha7000 shift calendar (Israel). Call `today` first to resolve relative dates. Answer the manager in Hebrew, short. Nothing can be changed through these tools: for changes, tell the manager to use the app or Shali.',
        }
      }
      case 'ping':
        return {}
      case 'tools/list':
        return { tools: tools.map(({ run: _run, ...t }) => t) }
      case 'tools/call': {
        const tool = tools.find((t) => t.name === params?.name)
        if (!tool) throw Object.assign(new Error(`unknown tool ${params?.name}`), { code: -32602 })
        try {
          const data = await tool.run(params.arguments ?? {})
          return { content: [{ type: 'text', text: JSON.stringify(data) }] }
        } catch (e) {
          return { content: [{ type: 'text', text: e.message }], isError: true }
        }
      }
    }
    if (id === undefined) return undefined // a notification (e.g. notifications/initialized): no answer
    throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 })
  }
}

export function serve(input = process.stdin, output = process.stdout, handle = makeHandler(makeTools(makeApi()))) {
  const send = (v) => output.write(`${JSON.stringify(v)}\n`)
  createInterface({ input }).on('line', async (line) => {
    if (!line.trim()) return
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
    }
    try {
      const result = await handle(msg)
      if (msg.id !== undefined && result !== undefined) send({ jsonrpc: '2.0', id: msg.id, result })
    } catch (e) {
      if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? -32603, message: e.message } })
    }
  })
}

const started = process.argv[1]?.replace(/\\/g, '/').split('/').pop()
if (started && import.meta.url.endsWith(`/${started}`)) serve()
