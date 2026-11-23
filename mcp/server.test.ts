import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs server without types
import { addDays, certsOn, constraintOn, constraintWhy, freeOn, isDate, makeApi, makeHandler, makeTools, readableShift } from './server.mjs'

const C = (o: Record<string, unknown>) => ({ id: 'k', kind: null, when: 'dates', from: null, to: null, weekdays: [], nightsOnly: false, part: null, ...o })
const W = (id: string, first: string, extra: Record<string, unknown> = {}) => ({
  id,
  firstName: first,
  lastName: 'כהן',
  status: 'active',
  sickUntil: null,
  departmentId: null,
  certifications: [{ id: 'c-climb', stars: 4, validUntil: null }],
  constraints: [],
  ...extra,
})
const S = (o: Record<string, unknown>) => ({ id: 's', date: '2026-11-25', shiftKindId: 'k-day', location: 'דימונה', jobDescription: 'אנטנה', crew: [], pinnedWorkerIds: [], staffing: [], workKindIds: [], urgent: false, startTime: null, endDate: null, endTime: null, fromPendingJobId: null, nextJob: null, closure: null, ...o })
const LISTS = { certs: [{ id: 'c-climb', name: 'טיפוס' }, { id: 'c-weld', name: 'רתך' }], kinds: [{ id: 'k-day', name: 'יום' }, { id: 'k-night', name: 'לילה' }], departments: [{ id: 'd1', name: 'אנטנות' }], workKinds: [] }

describe('dates and constraints', () => {
  it('accepts only real YYYY-MM-DD dates', () => {
    expect(isDate('2026-11-24')).toBe(true)
    for (const bad of ['מחר', '24.11.2026', '2026-13-01', '', null]) expect(isDate(bad)).toBe(false)
  })

  it('adds days across a month end', () => expect(addDays('2026-11-29', 3)).toBe('2026-12-02'))

  it('knows when a constraint hits a day', () => {
    expect(constraintOn(C({ from: '2026-11-25', to: '2026-11-27' }), '2026-11-26')).toBe('all')
    expect(constraintOn(C({ from: '2026-11-25', to: null }), '2026-11-25')).toBe('all')
    expect(constraintOn(C({ from: '2026-11-25', to: null }), '2026-11-26')).toBeNull()
    expect(constraintOn(C({ when: 'weekdays', weekdays: [3] }), '2026-11-25')).toBe('all') // Wednesday
    expect(constraintOn(C({ when: 'weekdays', weekdays: [3], nightsOnly: true }), '2026-11-25')).toBe('part')
    expect(constraintOn(C({ when: 'always', part: 'morning' }), '2026-11-25')).toBe('part')
  })

  it('says why in Hebrew', () => {
    expect(constraintWhy(C({ kind: 'vacation' }))).toBe('חופש')
    expect(constraintWhy(C({ nightsOnly: true }))).toBe('לא בלילות')
    expect(constraintWhy(C({ part: 'evening' }))).toBe('לא בערב')
    expect(constraintWhy(C({}))).toBe('אילוץ')
  })

  it('drops certifications that expired before the day', () => {
    const w = W('w', 'א', { certifications: [{ id: 'c-climb', stars: 3, validUntil: '2026-11-20' }, { id: 'c-weld', stars: 5, validUntil: '2026-12-31' }] })
    expect(certsOn(w, '2026-11-25', LISTS.certs)).toEqual(['רתך'])
  })
})

describe('who is free', () => {
  const workers = [
    W('w1', 'אבי'),
    W('w2', 'דני', { status: 'sick', sickUntil: '2026-11-30' }),
    W('w3', 'יוסי'),
    W('w4', 'משה', { constraints: [C({ kind: 'vacation', from: '2026-11-25', to: '2026-11-27' })] }),
    W('w5', 'אלי', { constraints: [C({ when: 'weekdays', weekdays: [3], nightsOnly: true })] }),
    W('w6', 'רון', { status: 'inactive' }),
    W('w7', 'גיל', { status: 'sick', sickUntil: '2026-11-24' }),
    W('w8', 'טל'),
  ]
  const shifts = [S({ id: 's1', crew: ['w3'] }), S({ id: 's2', date: '2026-11-23', endDate: '2026-11-26', crew: ['w8'], location: 'אילת' })]
  const r = freeOn('2026-11-25', workers, shifts, LISTS.certs)

  it('sorts everyone into free, partly free and not free', () => {
    expect(r.free.map((x: { name: string }) => x.name)).toEqual(['אבי כהן', 'גיל כהן']) // גיל is sick only until the day before
    expect(r.partlyFree).toEqual([{ id: 'w5', name: 'אלי כהן', certifications: ['טיפוס'], limits: ['לא בלילות'] }])
    expect(r.notFree).toEqual([
      { name: 'דני כהן', why: 'חולה עד 2026-11-30' },
      { name: 'יוסי כהן', why: 'משובץ בעבודה: דימונה' },
      { name: 'משה כהן', why: 'חופש' },
      { name: 'טל כהן', why: 'משובץ בעבודה: אילת' }, // a multi-day job that started earlier
    ])
  })

  it('leaves out inactive workers', () => expect(JSON.stringify(r)).not.toContain('רון'))
})

describe('readable jobs', () => {
  it('shows names instead of ids and counts who is missing', () => {
    const s = S({ crew: ['w1', 'gone'], staffing: [{ certificationIds: ['c-climb'], workKindId: null }, { certificationIds: [], workKindId: null }, { certificationIds: ['c-weld'], workKindId: null }] })
    expect(readableShift(s, { workers: [W('w1', 'אבי')], ...LISTS })).toEqual({
      id: 's',
      date: '2026-11-25',
      kind: 'יום',
      location: 'דימונה',
      job: 'אנטנה',
      crew: ['אבי כהן', '(עובד שנמחק gone)'],
      needs: ['טיפוס', 'ללא', 'רתך'],
      missing: 1,
    })
  })
})

describe('API errors', () => {
  it('asks for a key when none is set, without calling the API', async () => {
    let called = false
    const api = makeApi('', 'http://x', async () => ((called = true), new Response()))
    await expect(api.get('workers')).rejects.toThrow(/MASHA_API_KEY is not set/)
    expect(called).toBe(false)
  })

  it('explains a refused key', async () => {
    const api = makeApi('k', 'http://x', async () => new Response(JSON.stringify({ error: { code: 'bad-key' } }), { status: 401 }))
    await expect(api.get('workers')).rejects.toThrow(/refused/)
  })

  it('keeps the id-to-name lists for a few minutes', async () => {
    let calls = 0
    const api = makeApi('k', 'http://x', async () => (calls++, new Response(JSON.stringify({ data: [] }))))
    await api.named()
    await api.named()
    expect(calls).toBe(4)
  })
})

describe('tools', () => {
  const api = { get: async () => [], named: async () => LISTS }
  const handle = makeHandler(makeTools(api, () => '2026-11-23'))

  it('turns relative days into dates', async () => {
    const r = await handle({ id: 1, method: 'tools/call', params: { name: 'today', arguments: {} } })
    const out = JSON.parse(r.content[0].text)
    expect(out.today).toBe('2026-11-23')
    expect(out.days[1]).toEqual({ date: '2026-11-24', weekday: 'שלישי' })
  })

  it('returns a bad date as a tool error, and refuses unknown tools', async () => {
    const r = await handle({ id: 2, method: 'tools/call', params: { name: 'who_is_free', arguments: { date: 'מחר' } } })
    expect(r.isError).toBe(true)
    await expect(handle({ id: 3, method: 'tools/call', params: { name: 'delete_all', arguments: {} } })).rejects.toMatchObject({ code: -32602 })
  })

  it('has no tool that writes', async () => {
    const r = await handle({ id: 4, method: 'tools/list' })
    expect(r.tools.map((t: { name: string }) => t.name)).toEqual(['today', 'get_shifts', 'who_is_free', 'get_workers', 'get_pending_jobs'])
  })
})

describe('over stdio, against a fake API', () => {
  let api: Server
  const seen: string[] = []
  beforeAll(async () => {
    api = createServer((req, res) => {
      seen.push(`${req.method} ${req.headers.authorization}`)
      const what = new URL(req.url!, 'http://x').pathname.split('/').pop()!
      const data: Record<string, unknown> = { workers: [W('w1', 'אבי')], certifications: LISTS.certs, 'shift-kinds': LISTS.kinds }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ schemaVersion: 1, data: data[what] ?? [] }))
    }).listen(0)
    await new Promise((r) => api.once('listening', r))
  })
  afterAll(() => api.close())

  it('answers an MCP client and sends only GET with the key', async () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
      env: { ...process.env, MASHA_API_KEY: 'test-key', MASHA_API_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}/api/v1` },
    })
    const replies: Record<number, { result?: { protocolVersion?: string; content?: { text: string }[] } }> = {}
    let buf = ''
    child.stdout.on('data', (d) => {
      buf += d
      for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
        const m = JSON.parse(buf.slice(0, i))
        replies[m.id] = m
      }
    })
    const send = (v: unknown) => child.stdin.write(`${JSON.stringify(v)}\n`)
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'who_is_free', arguments: { date: '2026-11-25' } } })
    await expect.poll(() => replies[2], { timeout: 5000 }).toBeTruthy()
    child.kill()
    expect(replies[1].result?.protocolVersion).toBe('2025-06-18')
    expect(JSON.parse(replies[2].result!.content![0].text).free[0]).toEqual({ id: 'w1', name: 'אבי כהן', certifications: ['טיפוס'] })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((s) => s === 'GET Bearer test-key')).toBe(true)
  })
})
