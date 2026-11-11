import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seal } from './crypto.js'
import { readEnv } from './env.js'
import { KEYS } from './kv.js'
import { createKey } from './apiKeys.js'
import { GET, PATCH, POST } from '../v1.js'
import { SCHEMA } from './v1/contract.js'

// The outside API against a fake store (Redis over REST) and a fake Drive appDataFolder.

const KEY = Buffer.alloc(32, 7).toString('base64')
const BASE = 'https://masha7000.vercel.app/api/v1'

let store: Map<string, string | Set<string> | string[]>
let files: Map<string, { id: string; text: string }>
let nextId = 0
let beforeUpload: ((name: string) => void) | null

const md5 = (t: string) => createHash('md5').update(t).digest('hex')
const reply = (body: unknown, status = 200) => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
const byId = (id: string) => [...files.entries()].find(([, f]) => f.id === id)

async function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const url = String(input)
  if (url === 'https://kv.test') {
    const [cmd, key, ...rest] = JSON.parse(String(init!.body)) as string[]
    const set = () => (store.get(key) as Set<string>) ?? new Set<string>()
    const list = () => (store.get(key) as string[]) ?? []
    switch (cmd) {
      case 'GET': return reply({ result: (store.get(key) as string) ?? null })
      case 'SET': store.set(key, rest[0]); return reply({ result: 'OK' })
      case 'DEL': [key, ...rest].forEach((k) => store.delete(k)); return reply({ result: 1 })
      case 'SMEMBERS': return reply({ result: [...set()] })
      case 'SADD': store.set(key, set().add(rest[0])); return reply({ result: 1 })
      case 'SREM': { const s = set(); s.delete(rest[0]); store.set(key, s); return reply({ result: 1 }) }
      case 'INCR': { const n = Number(store.get(key) ?? 0) + 1; store.set(key, String(n)); return reply({ result: n }) }
      case 'EXPIRE': return reply({ result: 1 })
      case 'LPUSH': store.set(key, [rest[0], ...list()]); return reply({ result: 1 })
      case 'LTRIM': store.set(key, list().slice(Number(rest[0]), Number(rest[1]) + 1)); return reply({ result: 'OK' })
      case 'LRANGE': return reply({ result: list().slice(Number(rest[0]), Number(rest[1]) + 1) })
    }
  }
  const u = new URL(url)
  if (u.origin === 'https://www.googleapis.com') {
    const q = u.searchParams.get('q') ?? ''
    const media = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)
    if (media && u.searchParams.get('alt') === 'media') {
      const f = byId(media[1])
      return f ? reply(f[1].text) : reply({}, 404)
    }
    if (u.pathname === '/drive/v3/files') {
      const exact = q.match(/^name = '(.+)' and trashed = false$/)
      const contains = q.match(/^name contains '(.+)' and trashed = false$/)
      const found = [...files.entries()].filter(([n]) => (exact ? n === exact[1] : n.includes(contains![1])))
      return reply({ files: found.map(([name, f]) => ({ id: f.id, name, md5Checksum: md5(f.text) })) })
    }
    const upload = u.pathname.match(/^\/upload\/drive\/v3\/files\/?([^/]*)$/)
    if (upload) {
      if (init!.method === 'PATCH') {
        const f = byId(upload[1])!
        beforeUpload?.(f[0])
        f[1].text = String(init!.body)
      } else {
        const form = init!.body as FormData
        const meta = JSON.parse(await (form.get('metadata') as Blob).text()) as { name: string }
        beforeUpload?.(meta.name)
        files.set(meta.name, { id: `f${++nextId}`, text: await (form.get('file') as Blob).text() })
      }
      return reply({ id: 'x' })
    }
  }
  throw new Error(`unexpected fetch ${url}`)
}

const put = (name: string, data: unknown) => files.set(name, { id: `f${++nextId}`, text: JSON.stringify(data) })
const json = (name: string) => JSON.parse(files.get(name)!.text)

beforeEach(async () => {
  store = new Map()
  files = new Map()
  beforeUpload = null
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
  vi.stubEnv('SESSION_KEY', KEY)
  vi.stubEnv('OWNER_EMAIL', 'boss@example.com')
  vi.stubEnv('KV_REST_API_URL', 'https://kv.test')
  vi.stubEnv('KV_REST_API_TOKEN', 'kv-token')
  store.set(KEYS.access, await seal(KEY, { token: 'drive-token', exp: Date.now() + 3_600_000 }))
  put('workers.json', [
    {
      id: 'w1', firstName: 'אבי', lastName: 'כהן', certificationIds: ['general', 'c1'], certRatings: { c1: 3 }, certExpiry: { c1: '2027-01-01' },
      idNumber: '123456789', mobilePhone: '0501234567', address: 'יבנה', notes: 'סוד', constraints: [{ id: 'k1', when: 'dates', from: '2026-11-20', to: '2026-11-21', note: 'חתונה' }],
    },
    { id: 'w2', name: 'דני לוי', certificationIds: [], constraints: [], status: 'inactive' },
    { id: 'w3', firstName: 'יוסי', lastName: 'מזרחי', certificationIds: ['general'], constraints: [] },
  ])
  put('certifications.json', [{ id: 'c1', name: 'טיפוס' }])
  put('shift_definitions.json', [{ id: 'day', name: 'יום' }])
  put('departments.json', [{ id: 'd1', name: 'צפון' }])
  put('shifts-2026-10.json', [{ id: 's0', date: '2026-10-31', location: 'ערד', jobDescription: 'אנטנה', crew: [{ workerId: 'w1' }], staffing: [{ certificationId: 'c1', roleId: 'old' }] }])
  put('shifts-2026-11.json', [
    { id: 's1', date: '2026-11-02', location: 'דימונה', jobDescription: 'כבלים', crew: [{ workerId: 'w1' }], staffing: [{}] },
    { id: 's2', date: '2026-11-15', location: 'אילת', jobDescription: 'תורן', crew: [], staffing: [] },
  ])
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function key(write = false, personal = false) {
  return (await createKey(readEnv()!, { name: 'test', scopes: write ? ['read', 'write'] : ['read'], personal }))!.key
}

const call = (handler: (r: Request) => Promise<Response>, path: string, k: string | null, method = 'GET', body?: unknown) =>
  handler(
    new Request(`${BASE}?path=${encodeURIComponent(path.split('?')[0])}${path.includes('?') ? `&${path.split('?')[1]}` : ''}`, {
      method,
      headers: k ? { authorization: `Bearer ${k}` } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )

describe('keys', () => {
  it('refuses no key, a wrong key and a revoked key', async () => {
    expect((await call(GET, 'workers', null)).status).toBe(401)
    expect((await call(GET, 'workers', 'm7k_wrong')).status).toBe(401)
    const k = await key()
    expect((await call(GET, 'workers', k)).status).toBe(200)
    const hash = [...(store.get(KEYS.apiKeys) as Set<string>)][0]
    store.delete(KEYS.apiKey(hash))
    expect((await call(GET, 'workers', k)).status).toBe(401)
  })
  it('stores only the hash of the key', async () => {
    const k = await key()
    for (const [name, v] of store) expect(`${name}${typeof v === 'string' ? v : [...v].join()}`).not.toContain(k)
  })
  it('a read key cannot write', async () => {
    const res = await call(POST, 'pending-jobs', await key(), 'POST', { location: 'ערד' })
    expect(res.status).toBe(403)
    expect(json('workers.json')).toHaveLength(3)
  })
  it('stops a key after 60 calls a minute', async () => {
    const k = await key()
    for (let i = 0; i < 60; i++) await call(GET, 'certifications', k)
    expect((await call(GET, 'certifications', k)).status).toBe(429)
  })
  it('logs each call without its body', async () => {
    await call(GET, 'workers', await key())
    const log = (store.get(KEYS.apiLog) as string[]).map((l) => JSON.parse(l))
    expect(log[0]).toMatchObject({ method: 'GET', path: '/workers', status: 200 })
    expect(JSON.stringify(log)).not.toContain('אבי')
  })
})

describe('reads', () => {
  it('workers: active only, clean shape, no personal fields', async () => {
    const res = await (await call(GET, 'workers', await key())).json()
    expect(res.schemaVersion).toBe(1)
    expect(res.data.map((w: { id: string }) => w.id)).toEqual(['w1', 'w3'])
    const w1 = res.data[0]
    expect(w1.certifications).toEqual([{ id: 'general', stars: 5, validUntil: null }, { id: 'c1', stars: 3, validUntil: '2027-01-01' }])
    const text = JSON.stringify(res)
    for (const secret of ['123456789', '0501234567', 'יבנה', 'סוד', 'חתונה']) expect(text).not.toContain(secret)
    expect(w1.personal).toBeUndefined()
  })
  it('free-text notes of jobs and closures only with a personal key', async () => {
    put('pending_jobs.json', [{ id: 'j1', location: 'ערד', note: 'טלפון 0509999999', reasonIds: [], staffing: [] }])
    put('shifts-2026-11.json', [{ id: 's9', date: '2026-11-02', location: 'x', crew: [], staffing: [], closure: { outcome: 'done', note: 'ת.ז 222', reasonIds: [], closedAt: 't' } }])
    const plain = await key()
    const text = JSON.stringify([await (await call(GET, 'pending-jobs', plain)).json(), await (await call(GET, 'shifts/s9', plain)).json()])
    expect(text).not.toContain('0509999999')
    expect(text).not.toContain('222')
    const full = await (await call(GET, 'pending-jobs', await key(false, true))).json()
    expect(full.data[0].note).toBe('טלפון 0509999999')
  })
  it('personal fields only with a personal key', async () => {
    const res = await (await call(GET, 'workers/w1', await key(false, true))).json()
    expect(res.data.personal).toMatchObject({ idNumber: '123456789', mobilePhone: '0501234567', address: 'יבנה', notes: 'סוד' })
    expect(res.data.constraints[0].note).toBe('חתונה')
  })
  it('includes inactive workers when asked, old files upgraded', async () => {
    const res = await (await call(GET, 'workers?includeInactive=true', await key())).json()
    expect(res.data[1]).toMatchObject({ id: 'w2', firstName: 'דני', lastName: 'לוי', status: 'inactive' })
  })
  it('shifts in a range across month files, old fields left out', async () => {
    const res = await (await call(GET, 'shifts?from=2026-10-31&to=2026-11-10', await key())).json()
    expect(res.data.map((s: { id: string }) => s.id)).toEqual(['s0', 's1'])
    expect(res.data[0].staffing).toEqual([{ certificationIds: ['c1'], workKindId: null }])
    expect(JSON.stringify(res)).not.toContain('roleId')
  })
  it('refuses a bad or too long range', async () => {
    expect((await call(GET, 'shifts?from=2026-11-31&to=2026-12-01', await key())).status).toBe(422)
    expect((await call(GET, 'shifts?from=2025-01-01&to=2026-12-01', await key())).status).toBe(422)
  })
  it('one shift by id, unknown paths 404', async () => {
    const k = await key()
    expect((await (await call(GET, 'shifts/s2', k)).json()).data.location).toBe('אילת')
    expect((await call(GET, 'shifts/nope', k)).status).toBe(404)
    expect((await call(GET, 'nothing', k)).status).toBe(404)
  })
  it('certifications always hold "כללי"', async () => {
    const res = await (await call(GET, 'certifications', await key())).json()
    expect(res.data).toEqual([{ id: 'general', name: 'כללי' }, { id: 'c1', name: 'טיפוס' }])
  })
  it('the output matches the published schema', async () => {
    const k = await key(false, true)
    const check = (value: unknown, def: { properties: Record<string, unknown>; required: readonly string[] }) => {
      const v = value as Record<string, unknown>
      for (const r of def.required) expect(v, r).toHaveProperty(r)
      for (const field of Object.keys(v)) expect(def.properties, field).toHaveProperty(field)
    }
    for (const w of (await (await call(GET, 'workers', k)).json()).data) check(w, SCHEMA.$defs.Worker)
    for (const s of (await (await call(GET, 'shifts?from=2026-10-01&to=2026-11-30', k)).json()).data) check(s, SCHEMA.$defs.Shift)
  })
})

describe('writes', () => {
  it('creates a pending job', async () => {
    const res = await call(POST, 'pending-jobs', await key(true), 'POST', { location: 'ערד 17', jobDescription: 'החלפת אנטנה', staffing: [{ certificationIds: ['c1'] }, {}] })
    expect(res.status).toBe(201)
    const job = json('pending_jobs.json')[0]
    expect(job).toMatchObject({ location: 'ערד 17', staffing: [{ certificationIds: ['c1'] }, {}], reasonIds: [] })
  })
  it('refuses unknown fields and ids by name', async () => {
    const k = await key(true)
    const a = await (await call(POST, 'pending-jobs', k, 'POST', { location: 'x', colour: 'red' })).json()
    expect(a.error).toMatchObject({ code: 'invalid', field: 'colour' })
    const b = await (await call(POST, 'shifts', k, 'POST', { date: '2026-11-03', location: 'x', crew: ['ghost'] })).json()
    expect(b.error.field).toBe('crew')
    const c = await call(POST, 'shifts', k, 'POST', { date: '2026-11-03', location: 'x', crew: ['w2'] })
    expect((await c.json()).error.message).toContain('inactive')
  })
  it('creates a shift in its month file, a double booking is a warning', async () => {
    const res = await call(POST, 'shifts', await key(true), 'POST', { date: '2026-11-02', location: 'ירוחם', jobDescription: 'בדיקה', crew: ['w1'], staffing: [{ certificationIds: ['c1'] }] })
    expect(res.status).toBe(201)
    const out = await res.json()
    expect(out.warnings[0]).toContain('s1')
    expect(json('shifts-2026-11.json')).toHaveLength(3)
  })
  it('a shift in a new month makes that month file', async () => {
    await call(POST, 'shifts', await key(true), 'POST', { date: '2026-12-24', location: 'חיפה' })
    expect(json('shifts-2026-12.json')[0].location).toBe('חיפה')
  })
  it('patching a shift keeps unknown fields and records a swap', async () => {
    const res = await call(PATCH, 'shifts/s1', await key(true), 'PATCH', { crew: ['w3'] })
    expect(res.status).toBe(200)
    const s1 = json('shifts-2026-11.json').find((s: { id: string }) => s.id === 's1')
    expect(s1.crew).toEqual([{ workerId: 'w3' }])
    expect(s1.swaps[0]).toMatchObject({ outId: 'w1', inId: 'w3' })
  })
  it('moving a shift to another month moves it between files', async () => {
    await call(PATCH, 'shifts/s1', await key(true), 'PATCH', { date: '2026-12-01' })
    expect(json('shifts-2026-11.json').map((s: { id: string }) => s.id)).toEqual(['s2'])
    expect(json('shifts-2026-12.json')[0]).toMatchObject({ id: 's1', date: '2026-12-01', location: 'דימונה' })
  })
  it('a file changed during the call is a conflict and nothing is written', async () => {
    beforeUpload = () => {}
    const k = await key(true)
    // Someone saves the month file between the API's read and its write.
    const realFetch = fakeFetch
    let reads = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const u = String(input)
      if (u.includes("shifts-2026-11.json") && u.includes('name%20%3D') && ++reads === 2) {
        files.get('shifts-2026-11.json')!.text = JSON.stringify([{ id: 'other', date: '2026-11-09', crew: [], staffing: [] }])
      }
      return realFetch(input, init)
    }))
    const res = await call(PATCH, 'shifts/s2', k, 'PATCH', { location: 'עכו' })
    expect(res.status).toBe(409)
    expect(json('shifts-2026-11.json')).toEqual([{ id: 'other', date: '2026-11-09', crew: [], staffing: [] }])
  })
  it('updates a worker: status, certifications with stars and expiry', async () => {
    const k = await key(true)
    expect((await call(PATCH, 'workers/w3', k, 'PATCH', { status: 'sick' })).status).toBe(422)
    const res = await call(PATCH, 'workers/w3', k, 'PATCH', { status: 'sick', sickUntil: '2026-11-20', certifications: [{ id: 'c1', validUntil: '2027-05-01' }] })
    expect(res.status).toBe(200)
    const w3 = json('workers.json')[2]
    expect(w3).toMatchObject({ status: 'sick', sickUntil: '2026-11-20', certificationIds: ['general', 'c1'], certRatings: { c1: 0 }, certExpiry: { c1: '2027-05-01' } })
  })
  it('adds a constraint to a worker', async () => {
    const k = await key(true)
    expect((await call(POST, 'workers/w3/constraints', k, 'POST', { when: 'weekdays', weekdays: [7] })).status).toBe(422)
    const res = await call(POST, 'workers/w3/constraints', k, 'POST', { kind: 'vacation', from: '2026-12-01', to: '2026-12-05' })
    expect(res.status).toBe(201)
    expect(json('workers.json')[2].constraints[0]).toMatchObject({ when: 'dates', kind: 'vacation', from: '2026-12-01', to: '2026-12-05' })
  })
  it('waits for the app to split an old shifts.json first', async () => {
    put('shifts.json', [])
    expect((await call(POST, 'shifts', await key(true), 'POST', { date: '2026-11-03', location: 'x' })).status).toBe(409)
  })
})
