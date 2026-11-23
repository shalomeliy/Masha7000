#!/usr/bin/env node
// SPIKE (throwaway): a read-only MCP server over Masha7000's outside API (/api/v1).
// Claude Desktop (or Claude Code) starts it on the owner's PC and talks to it over stdin/stdout.
// No dependencies: MCP over stdio is newline-delimited JSON-RPC 2.0, small enough to write by hand
// for a spike. Only GET requests are ever sent, so it cannot change anything in the app.
//
// Env: MASHA_API_KEY (a key from Settings > נתונים וגוגל > גישת API; a key WITHOUT personal details
// is enough), MASHA_API_URL (default https://masha7000.vercel.app/api/v1).
import { createInterface } from 'node:readline'

const BASE = (process.env.MASHA_API_URL || 'https://masha7000.vercel.app/api/v1').replace(/\/$/, '')
const KEY = process.env.MASHA_API_KEY || ''
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

async function api(path) {
  if (!KEY) throw new Error('MASHA_API_KEY is not set in the MCP server config')
  const res = await fetch(`${BASE}/${path}`, { headers: { Authorization: `Bearer ${KEY}` } })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body || body.error) throw new Error(`API ${res.status}: ${body?.error?.message ?? body?.error?.code ?? 'no answer'}`)
  return body.data
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const weekday = (d) => new Date(`${d}T12:00:00Z`).getUTCDay()
const name = (w) => `${w.firstName} ${w.lastName}`.trim()

/** Is the worker blocked on this day by a constraint? 'all' = whole day, 'part' = only nights or part of the day. */
export function constraintOn(c, day) {
  const hits =
    c.when === 'always' ||
    (c.when === 'weekdays' && c.weekdays.includes(weekday(day))) ||
    (c.when === 'dates' && c.from && day >= c.from && day <= (c.to || c.from))
  if (!hits) return null
  return c.nightsOnly || c.part ? 'part' : 'all'
}

/** Who is free on a day: active, not sick then, not already in a job that day, no whole-day constraint. */
export function freeOn(day, workers, shifts) {
  const busy = new Set(shifts.filter((s) => s.date === day || (s.endDate && s.date < day && s.endDate >= day)).flatMap((s) => s.crew))
  const free = []
  const partly = []
  const away = []
  for (const w of workers) {
    if (w.status === 'inactive') continue
    if (w.status === 'sick' && (!w.sickUntil || w.sickUntil >= day)) { away.push({ name: name(w), why: 'sick' }); continue }
    if (busy.has(w.id)) { away.push({ name: name(w), why: 'already in a job' }); continue }
    const marks = w.constraints.map((c) => [c, constraintOn(c, day)]).filter(([, m]) => m)
    const whole = marks.find(([, m]) => m === 'all')
    if (whole) { away.push({ name: name(w), why: whole[0].kind || 'constraint' }); continue }
    const entry = { id: w.id, name: name(w), certifications: w.certifications.map((c) => c.id) }
    ;(marks.length ? partly : free).push(entry)
  }
  return { date: day, free, partlyFree: partly, notFree: away }
}

const TOOLS = [
  {
    name: 'get_shifts',
    description: 'Jobs in the Masha7000 calendar between two dates (inclusive, at most 366 days): date, place, job, crew worker ids, staffing needs.',
    inputSchema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['from', 'to'] },
    run: async ({ from, to }) => {
      if (!isDate(from) || !isDate(to)) throw new Error('from and to must be YYYY-MM-DD')
      return api(`shifts?from=${from}&to=${to}`)
    },
  },
  {
    name: 'get_workers',
    description: 'Active workers: names, status (active/sick), certifications with stars and expiry, constraints. No phone numbers or ID numbers.',
    inputSchema: { type: 'object', properties: {} },
    run: () => api('workers'),
  },
  {
    name: 'get_pending_jobs',
    description: 'Jobs waiting to be scheduled (no date yet).',
    inputSchema: { type: 'object', properties: {} },
    run: () => api('pending-jobs?waiting=true'),
  },
  {
    name: 'get_lists',
    description: 'The id-to-name lists: certifications, shift kinds (day/night...), departments, work kinds. Use them to turn ids into names.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const [certifications, shiftKinds, departments, workKinds] = await Promise.all(['certifications', 'shift-kinds', 'departments', 'work-kinds'].map(api))
      return { certifications, shiftKinds, departments, workKinds }
    },
  },
  {
    name: 'who_is_free',
    description: 'Who can work on a given day: free, partly free (night-only or part-of-day constraint), and who is not free and why.',
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] },
    run: async ({ date }) => {
      if (!isDate(date)) throw new Error('date must be YYYY-MM-DD')
      const [workers, shifts] = await Promise.all([api('workers'), api(`shifts?from=${date}&to=${date}`)])
      return freeOn(date, workers, shifts)
    },
  },
]

async function handle(msg) {
  const { id, method, params } = msg
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion
      return {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'masha7000', version: '0.0.1-spike' },
        instructions: 'Read-only access to the Masha7000 shift calendar. Workers are referenced by id in shifts; get_workers maps ids to names. Answer the manager in Hebrew.',
      }
    }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: TOOLS.map(({ run, ...t }) => t) }
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name)
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

const send = (v) => process.stdout.write(`${JSON.stringify(v)}\n`)

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  createInterface({ input: process.stdin }).on('line', async (line) => {
    if (!line.trim()) return
    let msg
    try { msg = JSON.parse(line) } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) }
    try {
      const result = await handle(msg)
      if (msg.id !== undefined && result !== undefined) send({ jsonrpc: '2.0', id: msg.id, result })
    } catch (e) {
      if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? -32603, message: e.message } })
    }
  })
}
