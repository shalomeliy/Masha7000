// SPIKE check: a fake /api/v1 on a local port, the MCP server as a child process, and a scripted
// MCP client conversation (what Claude Desktop does on start and on a tool call).
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const W = (id, first, extra = {}) => ({ id, firstName: first, lastName: 'כהן', status: 'active', sickUntil: null, departmentId: null, certifications: [{ id: 'c-climb', stars: 4, validUntil: null }], constraints: [], ...extra })
const DATA = {
  workers: [
    W('w1', 'אבי'),
    W('w2', 'דני', { status: 'sick', sickUntil: '2026-11-30' }),
    W('w3', 'יוסי'),
    W('w4', 'משה', { constraints: [{ id: 'k1', kind: 'vacation', when: 'dates', from: '2026-11-25', to: '2026-11-27', weekdays: [], nightsOnly: false, part: null }] }),
    W('w5', 'אלי', { constraints: [{ id: 'k2', kind: null, when: 'weekdays', from: null, to: null, weekdays: [3], nightsOnly: true, part: null }] }),
  ],
  shifts: [{ id: 's1', date: '2026-11-25', shiftKindId: 'k-day', location: 'דימונה', jobDescription: 'התקנת אנטנה', crew: ['w3'], pinnedWorkerIds: [], staffing: [{ count: 1 }], workKindIds: [], urgent: false, startTime: null, endDate: null, endTime: null, fromPendingJobId: null, nextJob: null, closure: null }],
}
const seen = []
const api = createServer((req, res) => {
  seen.push(`${req.method} ${req.url} auth=${req.headers.authorization === 'Bearer test-key'}`)
  const u = new URL(req.url, 'http://x')
  const what = u.pathname.split('/').pop()
  const data = what === 'shifts' ? DATA.shifts.filter((s) => s.date >= u.searchParams.get('from') && s.date <= u.searchParams.get('to')) : DATA[what] ?? []
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ schemaVersion: 1, data }))
}).listen(0)
await new Promise((r) => api.once('listening', r))

const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
  env: { ...process.env, MASHA_API_KEY: 'test-key', MASHA_API_URL: `http://127.0.0.1:${api.address().port}/api/v1` },
})
let buf = ''
const waiting = new Map()
child.stdout.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    waiting.get(m.id)?.(m); waiting.delete(m.id)
  }
})
let n = 0
const call = (method, params) => new Promise((r) => { const id = ++n; waiting.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`) })
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) process.exitCode = 1 }

const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'try', version: '0' } })
check(init.result?.protocolVersion === '2025-06-18' && init.result.capabilities.tools, 'initialize answers with tools capability')
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
const list = await call('tools/list', {})
check(list.result?.tools.length === 5, `tools/list: ${list.result?.tools.map((t) => t.name).join(', ')}`)
const free = await call('tools/call', { name: 'who_is_free', arguments: { date: '2026-11-25' } })
const f = JSON.parse(free.result.content[0].text)
console.log('      who_is_free 2026-11-25:', JSON.stringify({ free: f.free.map((x) => x.name), partly: f.partlyFree.map((x) => x.name), not: f.notFree }))
check(f.free.map((x) => x.id).join() === 'w1' && f.partlyFree[0]?.id === 'w5' && f.notFree.length === 3, 'who_is_free: sick, busy and on-vacation excluded; night-only constraint is "partly"')
const shifts = await call('tools/call', { name: 'get_shifts', arguments: { from: '2026-11-23', to: '2026-11-29' } })
check(JSON.parse(shifts.result.content[0].text)[0]?.location === 'דימונה', 'get_shifts returns the week')
const bad = await call('tools/call', { name: 'get_shifts', arguments: { from: 'מחר', to: 'x' } })
check(bad.result?.isError === true, 'bad date comes back as a tool error, not a crash')
const unknown = await call('tools/call', { name: 'delete_everything', arguments: {} })
check(unknown.error?.code === -32602, 'unknown tool is refused')
check(seen.every((s) => s.startsWith('GET ') && s.endsWith('auth=true')), `only GET with the key (${seen.length} requests)`)
child.kill(); api.close()
