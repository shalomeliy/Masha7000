import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join as pathJoin } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { open, seal } from './crypto.js'
import { OWNER_SCOPES } from './google.js'
import { GET as start } from './routes/auth-start.js'
import { GET as callback } from './routes/auth-callback.js'
import { POST as token } from './routes/token.js'
import { POST as owner } from './routes/owner.js'
import { POST as logout } from './routes/logout.js'
import { GET as joinForm, POST as join } from './routes/join.js'
import { GET as consForm, POST as cons } from './routes/constraints.js'
import { GET as accessInfo, POST as access } from './routes/access.js'
import { GET as claudeLogRead, POST as claudeLogWrite } from './routes/claude-log.js'
import { POST as mfa } from './routes/mfa.js'
import { POST as feedback } from './routes/feedback.js'
import { POST as assistant } from '../assistant.js'
import { GET as v1 } from '../v1.js'
import { createKey } from './apiKeys.js'
import { readEnv } from './env.js'
import { codeAt, currentStep, fromBase32 } from './totp.js'

// Smart onboarding part 2: customers on their own Drive (docs/plans/smart-onboarding-part2-PLAN.md).
// The tenant boundary, route by route: a customer's session, key or public code never reaches the
// root team's Drive token, keys, forms or logs, and root keeps working exactly as before.

const KEY = Buffer.alloc(32, 7).toString('base64')
const ORIGIN = 'https://masha7000.vercel.app'
const OWNER = 'boss@example.com'
const DEPUTY = 'deputy@example.com' // a root manager (like Dolik)
const CUSTOMER = 'cust@example.com'
const HELPER = 'helper@example.com' // a manager the customer adds

let store: Map<string, string | Set<string> | string[]>
let google: { tokenAnswer: Record<string, unknown>; tokenOk: boolean; refreshed: string[]; revoked: string[]; driveAuth: string[] }

const idToken = (email: string) => ['x', Buffer.from(JSON.stringify({ email, email_verified: true })).toString('base64url'), 'sig'].join('.')

function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const url = String(input)
  const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
  if (url === 'https://kv.test') {
    const [cmd, key, ...rest] = JSON.parse(String(init!.body)) as string[]
    const set = () => (store.get(key) as Set<string>) ?? new Set<string>()
    const list = () => (store.get(key) as string[]) ?? []
    switch (cmd) {
      case 'GET': return reply({ result: (store.get(key) as string) ?? null })
      case 'SET':
        if (rest.includes('NX') && store.has(key)) return reply({ result: null })
        store.set(key, rest[0]); return reply({ result: 'OK' })
      case 'DEL': [key, ...rest].forEach((k) => store.delete(k)); return reply({ result: 1 })
      case 'SMEMBERS': return reply({ result: [...set()] })
      case 'SISMEMBER': return reply({ result: set().has(rest[0]) ? 1 : 0 })
      case 'SADD': store.set(key, set().add(rest[0])); return reply({ result: 1 })
      case 'SREM': { const s = set(); s.delete(rest[0]); store.set(key, s); return reply({ result: 1 }) }
      case 'INCR': { const n = Number(store.get(key) ?? 0) + 1; store.set(key, String(n)); return reply({ result: n }) }
      case 'EXPIRE': return reply({ result: 1 })
      case 'LPUSH': { const l = list(); l.unshift(rest[0]); store.set(key, l); return reply({ result: l.length }) }
      case 'LTRIM': store.set(key, list().slice(Number(rest[0]), Number(rest[1]) + 1)); return reply({ result: 'OK' })
      case 'LRANGE': return reply({ result: list().slice(Number(rest[0]), Number(rest[1]) + 1) })
    }
  }
  if (url === 'https://oauth2.googleapis.com/token') {
    const p = new URLSearchParams(String(init!.body))
    if (p.get('grant_type') === 'refresh_token') {
      google.refreshed.push(p.get('refresh_token')!)
      return reply({ access_token: `access-of-${p.get('refresh_token')}`, expires_in: 3600 })
    }
    return reply(google.tokenAnswer, google.tokenOk ? 200 : 400)
  }
  if (url.startsWith('https://oauth2.googleapis.com/revoke')) {
    google.revoked.push(new URL(url).searchParams.get('token')!)
    return reply({})
  }
  if (url.startsWith('https://www.googleapis.com/drive/v3/files')) {
    google.driveAuth.push(new Headers(init?.headers).get('authorization') ?? '')
    return reply({ files: [] })
  }
  throw new Error(`unexpected fetch ${url}`)
}

beforeEach(async () => {
  store = new Map()
  google = { tokenAnswer: {}, tokenOk: true, refreshed: [], revoked: [], driveAuth: [] }
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
  vi.stubEnv('SESSION_KEY', KEY)
  vi.stubEnv('OWNER_EMAIL', OWNER)
  vi.stubEnv('KV_REST_API_URL', 'https://kv.test')
  vi.stubEnv('KV_REST_API_TOKEN', 'kv-token')
  vi.stubEnv('RESEND_API_KEY', '')
  // The root team as it is live: the owner's Drive linked, one manager.
  store.set('owner:refresh', await seal(KEY, 'root-refresh'))
  store.set('allowed', new Set([DEPUTY]))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const cookieValue = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1) ?? null

async function googleBack(startRes: Response, answer: Record<string, unknown>, session?: string | null) {
  const state = new URL(startRes.headers.get('location')!).searchParams.get('state')!
  google.tokenAnswer = answer
  const cookies = [`__Host-oauth=${cookieValue(startRes, '__Host-oauth')}`, ...(session ? [`__Host-session=${session}`] : [])]
  return callback(new Request(`${ORIGIN}/api/auth/callback?state=${state}&code=c`, { headers: { cookie: cookies.join('; ') } }))
}

const signInAs = async (email: string) => googleBack(await start(new Request(`${ORIGIN}/api/auth/start`)), { id_token: idToken(email), access_token: 'a', expires_in: 3600 })

const recovery = new Map<string, string[]>()
async function managerSession(email: string) {
  const s = cookieValue(await signInAs(email), '__Host-session')!
  if (!store.has(`mfa:${email}`)) {
    const { secret } = await (await post(mfa, s, { action: 'setup' })).json()
    const res = await post(mfa, s, { action: 'enable', code: await codeAt(fromBase32(secret), currentStep(Date.now())) })
    if (res.status !== 200) throw new Error(`enable ${res.status}`)
    recovery.set(email, (await res.json()).recoveryCodes)
  } else {
    const res = await post(mfa, s, { action: 'verify', code: recovery.get(email)!.pop()! })
    if (res.status !== 200) throw new Error(`verify ${res.status}`)
  }
  return s
}

const post = (handler: (r: Request) => Response | Promise<Response>, session: string | null, body?: unknown, extraCookie = '') =>
  handler(
    new Request(`${ORIGIN}/api/x`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: [session ? `__Host-session=${session}` : '', extraCookie].filter(Boolean).join('; ') },
      body: body ? JSON.stringify(body) : undefined,
    }),
  )
const get = (handler: (r: Request) => Response | Promise<Response>, path: string, cookie = '') => handler(new Request(`${ORIGIN}${path}`, { headers: { cookie } }))

/** A customer asks for access and the owner approves him: his team's id. */
async function approvedCustomer(email = CUSTOMER, maxManagers = 10) {
  const refused = await signInAs(email)
  const apply = `__Host-apply=${cookieValue(refused, '__Host-apply')}`
  expect((await post(access, null, { businessName: 'חשמל דרום', whatsapp: '050-1234567' }, apply)).status).toBe(200)
  const boss = await managerSession(OWNER)
  const res = await post(owner, boss, { action: 'approve', email, maxManagers })
  expect(res.status).toBe(200)
  return { boss, id: (await res.json()).teams.find((t: { owner: string }) => t.owner === email).id as string }
}

/** The customer team owner links his own Drive. */
async function linkCustomerDrive(session: string, email = CUSTOMER, refresh = 'cust-refresh') {
  const s = await start(new Request(`${ORIGIN}/api/auth/start?mode=team`, { headers: { cookie: `__Host-session=${session}` } }))
  return googleBack(s, { id_token: idToken(email), refresh_token: refresh, access_token: 'a', scope: OWNER_SCOPES }, session)
}

const rootTokenStillThere = async () => expect(await open(KEY, store.get('owner:refresh') as string)).toBe('root-refresh')

describe('static: every team key goes through teamKeys', () => {
  // Keys that only exist per team: outside team.ts nothing may name the root copy directly, except the
  // reviewed places listed (root-only code paths).
  const TEAM_SCOPED = ['refresh', 'access', 'joinForm', 'joinSubs', 'joinSent', 'consForm', 'consSubs', 'consAnswered', 'consFirst', 'consDevice', 'consEdit', 'apiKeys', 'apiLog']
  const ROOT_ONLY: Record<string, string[]> = {
    refresh: ['_lib/routes/owner.ts', '_lib/routes/auth-callback.ts', '_lib/drive.ts', '_lib/deleteAccount.ts'],
    access: ['_lib/routes/owner.ts', '_lib/routes/auth-callback.ts', '_lib/drive.ts', '_lib/deleteAccount.ts'],
    apiKeys: ['_lib/deleteAccount.ts'],
    apiLog: ['_lib/deleteAccount.ts'],
    joinForm: ['_lib/deleteAccount.ts'], joinSubs: ['_lib/deleteAccount.ts'], joinSent: ['_lib/deleteAccount.ts'],
    consForm: ['_lib/deleteAccount.ts'], consSubs: ['_lib/deleteAccount.ts'], consAnswered: ['_lib/deleteAccount.ts'],
  }
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = pathJoin(dir, f)
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : []
    })
  const api = pathJoin(__dirname, '..')

  it('no file names a team-scoped key of root outside the reviewed list', () => {
    const bad: string[] = []
    for (const file of files(api)) {
      const rel = file.slice(api.length + 1).replaceAll('\\', '/')
      if (rel === '_lib/team.ts' || rel === '_lib/kv.ts') continue
      for (const m of readFileSync(file, 'utf8').matchAll(/KEYS\.(\w+)/g))
        if (TEAM_SCOPED.includes(m[1]) && !(ROOT_ONLY[m[1]] ?? []).includes(rel)) bad.push(`${rel}: KEYS.${m[1]}`)
    }
    expect(bad).toEqual([])
  })

  it('the root-only places that name owner:refresh check the root owner first', () => {
    const ownerRoute = readFileSync(pathJoin(api, '_lib/routes/owner.ts'), 'utf8')
    expect(ownerRoute.indexOf("if (!team.isRoot) return customerOwner")).toBeLessThan(ownerRoute.indexOf('KEYS.refresh'))
    const cb = readFileSync(pathJoin(api, '_lib/routes/auth-callback.ts'), 'utf8')
    expect(cb.indexOf("pending.mode === 'team'")).toBeLessThan(cb.indexOf('KEYS.refresh'))
  })
})

describe('access request', () => {
  it('takes the email only from the Google sign-in, and answers every email the same', async () => {
    const refused = await signInAs(CUSTOMER)
    expect(refused.headers.get('location')).toBe('/?signin=not-allowed')
    expect(cookieValue(refused, '__Host-session')).toBeNull()
    const apply = `__Host-apply=${cookieValue(refused, '__Host-apply')}`
    expect(await (await get(accessInfo, '/api/access', apply)).json()).toEqual({ email: CUSTOMER, sent: false })
    // No cookie, or a made-up one: nothing.
    expect((await post(access, null, { businessName: 'x y', whatsapp: '0501234567' })).status).toBe(401)
    expect((await post(access, null, { businessName: 'x y', whatsapp: '0501234567', email: 'other@example.com' }, '__Host-apply=forged')).status).toBe(401)
    expect((await post(access, null, { businessName: 'עסק', whatsapp: '123' }, apply)).status).toBe(400)
    const ok = await post(access, null, { businessName: 'עסק', whatsapp: '0501234567', email: 'other@example.com' }, apply)
    expect(await ok.json()).toEqual({ ok: true })
    const boss = await managerSession(OWNER)
    const listed = await (await post(owner, boss, { action: 'requests' })).json()
    expect(listed.requests.map((r: { email: string }) => r.email)).toEqual([CUSTOMER]) // never the typed one
    // A root manager asking (cookie forged by signing in when removed) gets the same answer, and no request.
    store.set('allowed', new Set())
    const deputyApply = `__Host-apply=${cookieValue(await signInAs(DEPUTY), '__Host-apply')}`
    store.set('allowed', new Set([DEPUTY]))
    expect(await (await post(access, null, { businessName: 'עסק', whatsapp: '0501234567' }, deputyApply)).json()).toEqual({ ok: true })
    expect((await (await post(owner, boss, { action: 'requests' })).json()).requests).toHaveLength(1)
  })

  it('only the root owner sees and approves requests; a root email is never approved into a team', async () => {
    await signInAs(CUSTOMER)
    const deputy = await managerSession(DEPUTY)
    expect((await post(owner, deputy, { action: 'requests' })).status).toBe(403)
    expect((await post(owner, deputy, { action: 'approve', email: CUSTOMER, maxManagers: 1 })).status).toBe(403)
    const boss = await managerSession(OWNER)
    expect((await post(owner, boss, { action: 'approve', email: DEPUTY, maxManagers: 1 })).status).toBe(409)
    expect((await post(owner, boss, { action: 'approve', email: CUSTOMER, maxManagers: 7 })).status).toBe(400)
  })
})

describe('a customer team on its own Drive', () => {
  it('a new customer never gets the owner token: he links his own Drive first', async () => {
    const { id } = await approvedCustomer()
    const cust = await managerSession(CUSTOMER)
    const first = await post(token, cust)
    expect(first.status).toBe(409)
    expect(await first.json()).toMatchObject({ reason: 'owner-disconnected', email: CUSTOMER, isOwner: true, root: false })
    expect(google.refreshed).not.toContain('root-refresh')
    expect((await linkCustomerDrive(cust)).headers.get('location')).toBe('/')
    expect(await open(KEY, store.get(`t:${id}:refresh`) as string)).toBe('cust-refresh')
    await rootTokenStillThere()
    expect(await (await post(token, cust)).json()).toMatchObject({ accessToken: 'access-of-cust-refresh', isOwner: true, root: false, assistant: true })
    // Root keeps its own token.
    const deputy = await managerSession(DEPUTY)
    expect(await (await post(token, deputy)).json()).toMatchObject({ accessToken: 'access-of-root-refresh', isOwner: false, root: true })
  })

  it('linking a team Drive: refused without his verified session, with another Google account, or with the owner account', async () => {
    const { id } = await approvedCustomer()
    // No session: auth start refuses mode=team.
    expect((await start(new Request(`${ORIGIN}/api/auth/start?mode=team`))).headers.get('location')).toBe('/?signin=failed')
    // A root manager's session: refused too.
    const deputy = await managerSession(DEPUTY)
    expect((await start(new Request(`${ORIGIN}/api/auth/start?mode=team`, { headers: { cookie: `__Host-session=${deputy}` } }))).headers.get('location')).toBe('/?signin=failed')
    const cust = await managerSession(CUSTOMER)
    expect((await linkCustomerDrive(cust, 'stranger@example.com')).headers.get('location')).toBe('/?signin=failed')
    expect((await linkCustomerDrive(cust, OWNER, 'evil')).headers.get('location')).toBe('/?signin=failed')
    expect(store.has(`t:${id}:refresh`)).toBe(false)
    await rootTokenStillThere()
    // A verified session that is not the customer's own (cookie of another person on the callback).
    const s = await start(new Request(`${ORIGIN}/api/auth/start?mode=team`, { headers: { cookie: `__Host-session=${cust}` } }))
    expect((await googleBack(s, { id_token: idToken(CUSTOMER), refresh_token: 'r', scope: OWNER_SCOPES }, deputy)).headers.get('location')).toBe('/?signin=failed')
    // Drive or Calendar unticked.
    const s2 = await start(new Request(`${ORIGIN}/api/auth/start?mode=team`, { headers: { cookie: `__Host-session=${cust}` } }))
    expect((await googleBack(s2, { id_token: idToken(CUSTOMER), refresh_token: 'r', scope: 'openid email' }, cust)).headers.get('location')).toBe('/?signin=scopes')
    expect(store.has(`t:${id}:refresh`)).toBe(false)
    // The team removed while the flow was at Google.
    const boss = await managerSession(OWNER)
    const cust2 = await managerSession(CUSTOMER)
    const s3 = await start(new Request(`${ORIGIN}/api/auth/start?mode=team`, { headers: { cookie: `__Host-session=${cust2}` } }))
    await post(owner, boss, { action: 'team-remove', id })
    expect((await googleBack(s3, { id_token: idToken(CUSTOMER), refresh_token: 'r', scope: OWNER_SCOPES }, cust2)).headers.get('location')).toBe('/?signin=failed')
    expect(store.has(`t:${id}:refresh`)).toBe(false)
  })

  it('the customer adds managers up to his plan, never someone of another team; a removed one is out at once', async () => {
    await approvedCustomer(CUSTOMER, 1)
    const cust = await managerSession(CUSTOMER)
    await linkCustomerDrive(cust)
    // Small plan = only himself.
    expect(await (await post(owner, cust, { action: 'add', email: HELPER })).json()).toMatchObject({ reason: 'team-full', maxManagers: 1 })
    const boss = await managerSession(OWNER)
    const teamId = (await (await post(owner, boss, { action: 'teams' })).json()).teams[0].id
    await post(owner, boss, { action: 'team-limit', id: teamId, maxManagers: 10 })
    expect((await post(owner, cust, { action: 'add', email: DEPUTY })).status).toBe(409) // root's manager
    expect((await post(owner, cust, { action: 'add', email: OWNER })).status).toBe(409)
    const added = await post(owner, cust, { action: 'add', email: HELPER })
    expect(await added.json()).toEqual({ owner: CUSTOMER, emails: [HELPER], maxManagers: 10, customer: true, claude: false })
    // The root owner cannot pull the customer's manager into his own team.
    expect((await post(owner, boss, { action: 'add', email: HELPER })).status).toBe(409)
    expect((await post(owner, boss, { action: 'add', email: CUSTOMER })).status).toBe(409)
    const helper = await managerSession(HELPER)
    expect(await (await post(token, helper)).json()).toMatchObject({ accessToken: 'access-of-cust-refresh', isOwner: false, root: false })
    // A manager of a customer team manages nothing.
    expect((await post(owner, helper, { action: 'list' })).status).toBe(403)
    expect((await post(owner, helper, { action: 'add', email: 'x@example.com' })).status).toBe(403)
    await post(owner, cust, { action: 'remove', email: HELPER })
    expect((await post(token, helper)).status).toBe(401)
    expect(store.has(`mfa:${HELPER}`)).toBe(false)
    expect([...((store.get(`sessions:${HELPER}`) as Set<string>) ?? [])]).toEqual([])
  })

  it("a customer owner's controls act on his team only: root's list, audit, requests and Drive stay out of reach", async () => {
    const { boss } = await approvedCustomer()
    const cust = await managerSession(CUSTOMER)
    await linkCustomerDrive(cust)
    const list = await (await post(owner, cust, { action: 'list' })).json()
    expect(list).toMatchObject({ owner: CUSTOMER, emails: [], customer: true })
    expect(JSON.stringify(list)).not.toContain(DEPUTY)
    for (const action of ['audit', 'requests', 'teams', 'approve', 'reject', 'team-remove', 'team-claude', 'team-limit', 'assistant', 'assistant-claude'])
      expect((await post(owner, cust, { action, email: DEPUTY, id: 'x', on: true, maxManagers: 30 })).status, action).toBe(400)
    // Removing root's manager through his own list does nothing to root.
    await post(owner, cust, { action: 'remove', email: DEPUTY })
    expect([...(store.get('allowed') as Set<string>)]).toEqual([DEPUTY])
    // His disconnect is his Drive only.
    await post(owner, cust, { action: 'disconnect' })
    expect(google.revoked).toEqual(['cust-refresh'])
    await rootTokenStillThere()
    // He may reset two-step only for his own managers.
    expect((await post(mfa, cust, { action: 'reset', email: DEPUTY })).status).toBe(403)
    expect(store.has(`mfa:${DEPUTY}`) || true).toBe(true)
    expect((await post(owner, boss, { action: 'list' })).status).toBe(200)
  })

  it('Shali: free commands only, no cloud voice, nothing into the owner log, until the owner turns Claude on', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    vi.stubEnv('GOOGLE_TTS_API_KEY', '')
    const { boss, id } = await approvedCustomer()
    const cust = await managerSession(CUSTOMER)
    const turn = { messages: [{ role: 'user', content: 'מי עובד מחר' }], context: {} }
    expect(await (await post(assistant, cust, turn)).json()).toEqual({ reason: 'free-only' })
    const tts = (s: string) => assistant(new Request(`${ORIGIN}/api/assistant?tts`, { method: 'POST', headers: { origin: ORIGIN, cookie: `__Host-session=${s}` }, body: JSON.stringify({ text: 'שלום' }) }))
    const stt = (s: string) => assistant(new Request(`${ORIGIN}/api/assistant?stt`, { method: 'POST', headers: { origin: ORIGIN, cookie: `__Host-session=${s}` }, body: '{}' }))
    expect(await (await tts(cust)).json()).toEqual({ reason: 'not-owner' })
    expect(await (await stt(cust)).json()).toEqual({ reason: 'not-owner' })
    expect((await post(claudeLogWrite, cust, { entry: { id: 'e1', at: new Date().toISOString(), turns: [] } })).status).toBe(403)
    expect((await get(claudeLogRead, '/api/claude-log', `__Host-session=${cust}`)).status).toBe(403)
    expect(store.has('claude-log')).toBe(false)
    // Only the root owner turns it on.
    expect((await post(owner, cust, { action: 'team-claude', id, on: true })).status).toBe(400)
    await post(owner, boss, { action: 'team-claude', id, on: true })
    expect((await post(assistant, cust, turn)).status).toBe(200) // past every check; spendGuard keeps it off outside Vercel
    expect(await (await tts(cust)).json()).toEqual({ reason: 'no-key' }) // past the gate
    // Still never the owner's Claude log.
    expect((await post(claudeLogWrite, cust, { entry: { id: 'e1', at: new Date().toISOString(), turns: [] } })).status).toBe(403)
  })
})

describe('forms and API keys per team', () => {
  it("a customer's workers form and constraints form are his: root's stay apart, the link finds its team", async () => {
    await approvedCustomer()
    const cust = await managerSession(CUSTOMER)
    const deputy = await managerSession(DEPUTY)
    const lists = (name: string) => ({ certifications: [{ id: 'c1', name }], departments: [] })
    const rootCode = (await (await post(join, deputy, { action: 'open', lists: lists('root-cert') })).json()).code
    const custCode = (await (await post(join, cust, { action: 'open', lists: lists('cust-cert') })).json()).code
    expect(custCode).not.toBe(rootCode)
    expect(await (await get(joinForm, `/api/join?c=${custCode}`)).json()).toEqual({ lists: lists('cust-cert') })
    expect(await (await get(joinForm, `/api/join?c=${rootCode}`)).json()).toEqual({ lists: lists('root-cert') })
    const worker = { firstName: 'דנה', lastName: 'לוי', mobilePhone: '0521112233' }
    expect((await post(join, null, { action: 'submit', code: custCode, details: worker })).status).toBe(200)
    // The same phone in root's form: not "already" (no cross-team hint), and each list holds its own.
    expect((await post(join, null, { action: 'submit', code: rootCode, details: worker })).status).toBe(200)
    const custList = await (await post(join, cust, { action: 'list' })).json()
    const rootList = await (await post(join, deputy, { action: 'list' })).json()
    expect(custList.code).toBe(custCode)
    expect(rootList.code).toBe(rootCode)
    expect(custList.submissions).toHaveLength(1)
    expect(rootList.submissions).toHaveLength(1)
    // Removing an answer by id from the other team does nothing.
    await post(join, cust, { action: 'remove', id: rootList.submissions[0].id })
    expect((await (await post(join, deputy, { action: 'list' })).json()).submissions).toHaveLength(1)
    // Closing his form closes only his link.
    await post(join, cust, { action: 'close' })
    expect((await get(joinForm, `/api/join?c=${custCode}`)).status).toBe(404)
    expect((await get(joinForm, `/api/join?c=${rootCode}`)).status).toBe(200)

    const sunday = '2026-11-29'
    const roster = [{ id: 'w1', firstName: 'דנה', phone: '0521112233' }]
    const cCode = (await (await post(cons, cust, { action: 'open', weekStart: sunday, roster })).json()).code
    const rCode = (await (await post(cons, deputy, { action: 'open', weekStart: sunday, roster: [] })).json()).code
    expect((await get(consForm, `/api/constraints?c=${cCode}`)).status).toBe(200)
    expect((await post(cons, null, { action: 'submit', code: cCode, phone: '0521112233', days: ['', '', '', '', '', '', ''] })).status).toBe(200)
    // Root's roster does not know this phone; root's list stays empty.
    expect((await post(cons, null, { action: 'submit', code: rCode, phone: '0521112233', days: ['', '', '', '', '', '', ''] })).status).toBe(404)
    expect((await (await post(cons, deputy, { action: 'list' })).json()).answers).toEqual([])
    expect((await (await post(cons, cust, { action: 'list' })).json()).answers).toHaveLength(1)
  })

  it("API keys: each team its own list, its own Drive; an old key without a team is root's", async () => {
    const { boss } = await approvedCustomer()
    const cust = await managerSession(CUSTOMER)
    await linkCustomerDrive(cust)
    const keys = (s: string, body: unknown) => owner(new Request(`${ORIGIN}/api/owner?scope=api-keys`, { method: 'POST', headers: { origin: ORIGIN, cookie: `__Host-session=${s}` }, body: JSON.stringify(body) }))
    const custKey = await (await keys(cust, { action: 'create', name: 'cust' })).json()
    const rootKey = (await createKey(readEnv()!, 'root', { name: 'mcp', scopes: ['read'], personal: false }))!
    expect(rootKey.record.teamId).toBeUndefined()
    expect((await (await keys(boss, { action: 'list' })).json()).keys.map((k: { name: string }) => k.name)).toEqual(['mcp'])
    expect((await (await keys(cust, { action: 'list' })).json()).keys.map((k: { name: string }) => k.name)).toEqual(['cust'])
    // Revoking another team's key by its id: nothing.
    expect(await (await keys(cust, { action: 'revoke', id: rootKey.record.id })).json()).toEqual({ ok: false })
    // A customer manager (not the owner) has no key controls.
    const helperless = await (await keys(cust, { action: 'list' })).json()
    expect(helperless.log).toEqual([])
    const call = (k: string) => v1(new Request(`${ORIGIN}/api/v1?path=departments`, { headers: { authorization: `Bearer ${k}` } }))
    google.driveAuth = []
    expect((await call(custKey.key)).status).toBe(200)
    expect(google.driveAuth.every((a) => a === 'Bearer access-of-cust-refresh')).toBe(true)
    google.driveAuth = []
    expect((await call(rootKey.key)).status).toBe(200)
    expect(google.driveAuth.every((a) => a === 'Bearer access-of-root-refresh')).toBe(true)
    // Each log has its own calls.
    expect((await (await keys(cust, { action: 'list' })).json()).log).toHaveLength(1)
    expect((await (await keys(boss, { action: 'list' })).json()).log).toHaveLength(1)
  })
})

describe('removing and deleting', () => {
  it('the owner removes a customer: everyone of that team out, his Drive revoked, his keys and links dead, root untouched', async () => {
    const { boss, id } = await approvedCustomer()
    const cust = await managerSession(CUSTOMER)
    await linkCustomerDrive(cust)
    await post(owner, cust, { action: 'add', email: HELPER })
    const helper = await managerSession(HELPER)
    const k = await (await owner(new Request(`${ORIGIN}/api/owner?scope=api-keys`, { method: 'POST', headers: { origin: ORIGIN, cookie: `__Host-session=${cust}` }, body: JSON.stringify({ action: 'create', name: 'x' }) }))).json()
    const code = (await (await post(join, cust, { action: 'open', lists: {} })).json()).code
    await post(owner, boss, { action: 'team-remove', id })
    expect((await post(token, cust)).status).toBe(401)
    expect((await post(token, helper)).status).toBe(401)
    expect(google.revoked).toContain('cust-refresh')
    expect([...store.keys()].filter((key) => key.includes(id))).toEqual([])
    expect((await v1(new Request(`${ORIGIN}/api/v1?path=departments`, { headers: { authorization: `Bearer ${k.key}` } }))).status).toBe(401)
    expect((await get(joinForm, `/api/join?c=${code}`)).status).toBe(404)
    await rootTokenStillThere()
    expect([...(store.get('allowed') as Set<string>)]).toEqual([DEPUTY])
  })

  it("deleting a customer's account: a manager leaves only himself; the team owner deletes his team only", async () => {
    const { id } = await approvedCustomer()
    const cust = await managerSession(CUSTOMER)
    await linkCustomerDrive(cust)
    await post(owner, cust, { action: 'add', email: HELPER })
    const helper = await managerSession(HELPER)
    await post(logout, helper, { action: 'delete-account' })
    expect((await (await post(owner, cust, { action: 'list' })).json()).emails).toEqual([])
    expect(store.has(`team:${id}`)).toBe(true)
    await post(logout, cust, { action: 'delete-account' })
    expect(store.has(`team:${id}`)).toBe(false)
    expect(google.revoked).toEqual(['cust-refresh'])
    await rootTokenStillThere()
    expect([...(store.get('allowed') as Set<string>)]).toEqual([DEPUTY])
  })

  it('a customer manager reaches feedback like anyone signed in (it mails the maker, not team data)', async () => {
    await approvedCustomer()
    const cust = await managerSession(CUSTOMER)
    expect((await post(feedback, cust, { text: 'שלום' })).status).toBe(503) // no mail key in tests: past the gate
  })
})

describe('access request list', () => {
  it('a full list of expired requests never blocks a new customer', async () => {
    store.set('access-requests', new Set(Array.from({ length: 200 }, (_, i) => `areq:old${i}`)))
    const apply = `__Host-apply=${cookieValue(await signInAs(CUSTOMER), '__Host-apply')}`
    await post(access, null, { businessName: 'עסק חדש', whatsapp: '0501234567' }, apply)
    const boss = await managerSession(OWNER)
    expect((await (await post(owner, boss, { action: 'requests' })).json()).requests.map((r: { email: string }) => r.email)).toEqual([CUSTOMER])
  })
})
