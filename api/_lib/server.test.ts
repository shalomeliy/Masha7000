import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { open, seal } from './crypto.js'
import { readEnv } from './env.js'
import { authUrl, OWNER_SCOPES } from './google.js'
import { GET as start } from '../auth/start.js'
import { GET as callback } from '../auth/callback.js'
import { POST as token } from '../token.js'
import { POST as owner } from '../owner.js'
import { POST as logout } from '../logout.js'
import { GET as joinForm, POST as join } from '../join.js'
import { POST as mfa } from '../mfa.js'
import { codeAt, currentStep, fromBase32 } from './totp.js'

const KEY = Buffer.alloc(32, 7).toString('base64')
const ORIGIN = 'https://masha7000.vercel.app'
const OWNER = 'boss@example.com'

// A fake Upstash (Redis over REST) and a fake Google, behind one stubbed fetch.
let store: Map<string, string | Set<string>>
let google: { tokenAnswer: Record<string, unknown>; tokenOk: boolean; tokenCalls: URLSearchParams[]; revoked: string[] }

const idToken = (email: string) =>
  ['x', Buffer.from(JSON.stringify({ email, email_verified: true })).toString('base64url'), 'sig'].join('.')

function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const url = String(input)
  const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
  if (url === 'https://kv.test') {
    const [cmd, key, ...rest] = JSON.parse(String(init!.body)) as string[]
    const set = () => (store.get(key) as Set<string>) ?? new Set<string>()
    switch (cmd) {
      case 'GET': return reply({ result: (store.get(key) as string) ?? null })
      case 'SET': store.set(key, rest[0]); return reply({ result: 'OK' })
      case 'DEL': [key, ...rest].forEach((k) => store.delete(k)); return reply({ result: 1 })
      case 'SMEMBERS': return reply({ result: [...set()] })
      case 'SISMEMBER': return reply({ result: set().has(rest[0]) ? 1 : 0 })
      case 'SADD': store.set(key, set().add(rest[0])); return reply({ result: 1 })
      case 'SREM': { const s = set(); s.delete(rest[0]); store.set(key, s); return reply({ result: 1 }) }
      case 'INCR': { const n = Number(store.get(key) ?? 0) + 1; store.set(key, String(n)); return reply({ result: n }) }
      case 'EXPIRE': return reply({ result: 1 })
    }
  }
  if (url === 'https://oauth2.googleapis.com/token') {
    google.tokenCalls.push(new URLSearchParams(String(init!.body)))
    return reply(google.tokenAnswer, google.tokenOk ? 200 : 400)
  }
  if (url.startsWith('https://oauth2.googleapis.com/revoke')) {
    google.revoked.push(new URL(url).searchParams.get('token')!)
    return reply({})
  }
  throw new Error(`unexpected fetch ${url}`)
}

beforeEach(() => {
  store = new Map()
  google = { tokenAnswer: {}, tokenOk: true, tokenCalls: [], revoked: [] }
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
  vi.stubEnv('SESSION_KEY', KEY)
  vi.stubEnv('OWNER_EMAIL', OWNER)
  vi.stubEnv('KV_REST_API_URL', 'https://kv.test')
  vi.stubEnv('KV_REST_API_TOKEN', 'kv-token')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const cookieValue = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1) ?? null

async function signInAs(email: string) {
  const s = await start(new Request(`${ORIGIN}/api/auth/start`))
  const state = new URL(s.headers.get('location')!).searchParams.get('state')!
  google.tokenAnswer = { id_token: idToken(email), access_token: 'a', expires_in: 3600 }
  return callback(
    new Request(`${ORIGIN}/api/auth/callback?state=${state}&code=c`, {
      headers: { cookie: `__Host-oauth=${cookieValue(s, '__Host-oauth')}` },
    }),
  )
}

/** Signs in and passes two-step: a first device sets the app up, a later one types a code. */
async function managerSession(email: string, now = Date.now()) {
  const s = cookieValue(await signInAs(email), '__Host-session')!
  const secretKey = `mfa:${email}`
  if (!store.has(secretKey)) {
    const { secret } = await (await post(mfa, s, { action: 'setup' })).json()
    phones.set(email, secret)
    const res = await post(mfa, s, { action: 'enable', code: await codeAt(fromBase32(secret), currentStep(now)) })
    if (res.status !== 200) throw new Error(`enable ${res.status}`)
    recovery.set(email, (await res.json()).recoveryCodes)
  } else {
    // A code from the app works once per 30 seconds, so a later device here uses a backup code.
    const res = await post(mfa, s, { action: 'verify', code: recovery.get(email)!.pop()! })
    if (res.status !== 200) throw new Error(`verify ${res.status}`)
  }
  return s
}
const phones = new Map<string, string>()
const recovery = new Map<string, string[]>()

const post = (handler: (r: Request) => Response | Promise<Response>, session: string | null, body?: unknown, origin = ORIGIN) =>
  handler(
    new Request(`${ORIGIN}/api/x`, {
      method: 'POST',
      headers: { origin, ...(session ? { cookie: `__Host-session=${session}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
  )

describe('crypto', () => {
  it('opens what it sealed, and nothing changed or foreign', async () => {
    const text = await seal(KEY, { a: 1 })
    expect(await open(KEY, text)).toEqual({ a: 1 })
    expect(await open(KEY, text.slice(0, -2) + 'AA')).toBeNull()
    expect(await open(Buffer.alloc(32, 8).toString('base64'), text)).toBeNull()
    expect(await open(KEY, 'garbage')).toBeNull()
  })
})

describe('env and auth url', () => {
  it('is not configured while any value is missing', () => {
    expect(readEnv({ VITE_GOOGLE_CLIENT_ID: 'x' })).toBeNull()
  })
  it('takes a plain Redis connection string when there is no REST store', () => {
    const base = { VITE_GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', SESSION_KEY: KEY, OWNER_EMAIL: OWNER }
    expect(readEnv({ ...base, REDIS_URL: 'redis://x' })).toMatchObject({ kvUrl: 'redis://x', kvToken: 'tcp' })
    expect(readEnv({ ...base, STORAGE_REDIS_URL: 'redis://y' })).toMatchObject({ kvUrl: 'redis://y' })
  })
  it('asks offline Drive access only in owner mode', () => {
    const env = readEnv()!
    const owner = new URL(authUrl(env, 'owner', 's', 'c')).searchParams
    const identity = new URL(authUrl(env, 'identity', 's', 'c')).searchParams
    expect(owner.get('access_type')).toBe('offline')
    expect(owner.get('scope')).toContain('drive.appdata')
    expect(identity.get('access_type')).toBeNull()
    expect(identity.get('scope')).toBe('openid email')
    expect(identity.get('code_challenge_method')).toBe('S256')
  })
})

describe('sign-in callback', () => {
  it('refuses a missing or wrong state', async () => {
    const res = await callback(new Request(`${ORIGIN}/api/auth/callback?state=x&code=c`))
    expect(res.headers.get('location')).toBe('/?signin=failed')
    expect(cookieValue(res, '__Host-session')).toBeNull()
  })

  it('gives no session to an email not on the list', async () => {
    const res = await signInAs('stranger@example.com')
    expect(res.headers.get('location')).toBe('/?signin=not-allowed')
    expect(cookieValue(res, '__Host-session')).toBeNull()
  })

  it('sends the owner on to grant Drive access the first time', async () => {
    const res = await signInAs(OWNER)
    expect(res.headers.get('location')).toBe('/api/auth/start?mode=owner')
    expect(cookieValue(res, '__Host-session')).toBeTruthy()
  })

  it('stores the owner refresh token sealed after the owner grant', async () => {
    const s = await start(new Request(`${ORIGIN}/api/auth/start?mode=owner`))
    const state = new URL(s.headers.get('location')!).searchParams.get('state')!
    google.tokenAnswer = { id_token: idToken(OWNER), refresh_token: 'refresh-1', access_token: 'a', scope: OWNER_SCOPES }
    const res = await callback(
      new Request(`${ORIGIN}/api/auth/callback?state=${state}&code=c`, {
        headers: { cookie: `__Host-oauth=${cookieValue(s, '__Host-oauth')}` },
      }),
    )
    expect(res.headers.get('location')).toBe('/')
    const stored = store.get('owner:refresh') as string
    expect(stored).not.toContain('refresh-1')
    expect(await open(KEY, stored)).toBe('refresh-1')
  })

  it('refuses an owner grant with Drive unticked', async () => {
    const s = await start(new Request(`${ORIGIN}/api/auth/start?mode=owner`))
    const state = new URL(s.headers.get('location')!).searchParams.get('state')!
    google.tokenAnswer = { id_token: idToken(OWNER), refresh_token: 'r', scope: 'openid email https://www.googleapis.com/auth/calendar.app.created' }
    const res = await callback(
      new Request(`${ORIGIN}/api/auth/callback?state=${state}&code=c`, {
        headers: { cookie: `__Host-oauth=${cookieValue(s, '__Host-oauth')}` },
      }),
    )
    expect(res.headers.get('location')).toBe('/?signin=scopes')
    expect(store.has('owner:refresh')).toBe(false)
  })

  it('lets an allowed email in', async () => {
    store.set('allowed', new Set(['deputy@example.com']))
    const res = await signInAs('deputy@example.com')
    expect(res.headers.get('location')).toBe('/')
    expect(res.headers.getSetCookie().join()).toContain('HttpOnly; Secure; SameSite=Lax')
  })
})

describe('token', () => {
  async function sessionFor(email: string) {
    store.set('allowed', new Set(['deputy@example.com']))
    store.set('owner:refresh', await seal(KEY, 'refresh-1'))
    return managerSession(email)
  }

  it('refuses another site, and a missing session', async () => {
    const s = await sessionFor('deputy@example.com')
    expect((await post(token, s, undefined, 'https://evil.example')).status).toBe(403)
    expect((await post(token, null)).status).toBe(401)
  })

  it('gives an allowed person the owner token, then reuses the cached one', async () => {
    const s = await sessionFor('deputy@example.com')
    google.tokenAnswer = { access_token: 'owner-access', expires_in: 3600 }
    google.tokenCalls = []
    const first = await post(token, s)
    expect(first.headers.get('cache-control')).toBe('no-store')
    expect(await first.json()).toMatchObject({ accessToken: 'owner-access', email: 'deputy@example.com', isOwner: false })
    await post(token, s)
    expect(google.tokenCalls.filter((p) => p.get('grant_type') === 'refresh_token')).toHaveLength(1)
  })

  it('asks Google again when the app says the cached token was refused', async () => {
    const s = await sessionFor('deputy@example.com')
    google.tokenAnswer = { access_token: 'old', expires_in: 3600 }
    await post(token, s)
    google.tokenAnswer = { access_token: 'new', expires_in: 3600 }
    expect(await (await post(token, s)).json()).toMatchObject({ accessToken: 'old' })
    expect(await (await post(token, s, { stale: true })).json()).toMatchObject({ accessToken: 'new' })
  })

  it('answers a crash with JSON the app reads as a failure', async () => {
    const s = await sessionFor('deputy@example.com')
    vi.stubEnv('KV_REST_API_URL', 'https://kv.down')
    const res = await post(token, s)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ reason: 'server-error' })
  })

  it('shuts out a removed email at the next request', async () => {
    const s = await sessionFor('deputy@example.com')
    store.set('allowed', new Set())
    expect(await (await post(token, s)).json()).toEqual({ reason: 'not-allowed' })
  })

  it('reports the owner disconnected and forgets the token when Google refuses it', async () => {
    const s = await sessionFor('deputy@example.com')
    google.tokenOk = false
    google.tokenAnswer = { error: 'invalid_grant' }
    const res = await post(token, s)
    expect(res.status).toBe(409)
    expect(store.has('owner:refresh')).toBe(false)
  })

  it('says not configured when the server has no settings', async () => {
    vi.stubEnv('SESSION_KEY', '')
    expect(await (await post(token, null)).json()).toEqual({ reason: 'not-configured', missing: ['SESSION_KEY'] })
  })
})

describe('owner controls', () => {
  it('only the owner can change the list', async () => {
    store.set('allowed', new Set(['deputy@example.com']))
    store.set('owner:refresh', await seal(KEY, 'refresh-1'))
    const deputy = await managerSession('deputy@example.com')
    expect((await post(owner, deputy, { action: 'add', email: 'x@example.com' })).status).toBe(403)

    const boss = await managerSession(OWNER)
    const added = await post(owner, boss, { action: 'add', email: ' New@Example.com ' })
    expect(await added.json()).toEqual({ owner: OWNER, emails: ['deputy@example.com', 'new@example.com'] })
    expect((await post(owner, boss, { action: 'add', email: 'not an email' })).status).toBe(400)
    await post(owner, boss, { action: 'remove', email: 'deputy@example.com' })
    expect(await (await post(owner, boss, { action: 'list' })).json()).toEqual({ owner: OWNER, emails: ['new@example.com'] })
  })

  it('disconnect revokes the Drive token at Google', async () => {
    store.set('owner:refresh', await seal(KEY, 'refresh-1'))
    const boss = await managerSession(OWNER)
    await post(owner, boss, { action: 'disconnect' })
    expect(google.revoked).toEqual(['refresh-1'])
    expect(store.has('owner:refresh')).toBe(false)
  })

  it('logout clears only the session cookie', async () => {
    const res = await post(logout, null)
    expect(res.headers.getSetCookie()[0]).toMatch(/^__Host-session=; Max-Age=0/)
  })
})

describe('workers details form', () => {
  const lists = {
    roles: [{ id: 'r1', name: 'חשמלאי' }],
    certifications: [{ id: 'c1', name: 'עבודה בגובה' }],
    departments: [{ id: 'd1', name: 'צפון' }],
  }
  const details = { firstName: ' דנה ', lastName: 'לוי', mobilePhone: '050-1234567', idNumber: '012345678', roleIds: ['r1', 'nope'], departmentId: 'd1', extra: 'x' }
  const manager = async () => {
    store.set('allowed', new Set(['deputy@example.com']))
    return managerSession('deputy@example.com')
  }
  const openForm = async (s: string, extra = {}) => (await (await post(join, s, { action: 'open', lists, ...extra })).json()).code as string

  it('only a signed-in manager opens it, and opening again keeps the same link', async () => {
    expect((await post(join, null, { action: 'open', lists })).status).toBe(401)
    const s = await manager()
    const code = await openForm(s)
    expect(code).toMatch(/^[\w-]{16}$/)
    expect(await openForm(s)).toBe(code)
    expect(await openForm(s, { renew: true })).not.toBe(code)
  })

  it('shows its lists to anyone with the link, and nothing to a wrong or closed link', async () => {
    const s = await manager()
    const code = await openForm(s)
    expect(await (await joinForm(new Request(`${ORIGIN}/api/join?c=${code}`))).json()).toEqual({ lists })
    expect((await joinForm(new Request(`${ORIGIN}/api/join?c=wrong`))).status).toBe(404)
    await post(join, s, { action: 'close' })
    expect((await joinForm(new Request(`${ORIGIN}/api/join?c=${code}`))).status).toBe(404)
    expect((await post(join, null, { action: 'submit', code, details })).status).toBe(404)
  })

  it('stores a worker answer sealed and cleaned, for the manager to list and remove', async () => {
    const s = await manager()
    const code = await openForm(s)
    expect((await post(join, null, { action: 'submit', code, details }, 'https://evil.example')).status).toBe(403)
    expect((await post(join, null, { action: 'submit', code, details: { ...details, mobilePhone: '123' } })).status).toBe(400)
    expect((await post(join, null, { action: 'submit', code, details })).status).toBe(200)
    const stored = [...(store.get('join:subs') as Set<string>)][0]
    expect(stored).not.toContain('012345678')

    const { submissions } = await (await post(join, s, { action: 'list' })).json()
    expect(submissions).toHaveLength(1)
    expect(submissions[0]).toMatchObject({ firstName: 'דנה', lastName: 'לוי', roleIds: ['r1'], departmentId: 'd1', certificationIds: [] })
    expect(submissions[0].extra).toBeUndefined()
    expect((await post(join, null, { action: 'list' })).status).toBe(401)

    await post(join, s, { action: 'remove', id: submissions[0].id })
    expect((await (await post(join, s, { action: 'list' })).json()).submissions).toEqual([])
  })

  it('takes one answer per person: same mobile or ID number is refused, until a manager throws it away', async () => {
    const s = await manager()
    const code = await openForm(s)
    expect((await post(join, null, { action: 'submit', code, details })).status).toBe(200)
    expect([...(store.get('join:sent') as Set<string>)].join()).not.toContain('0501234567')
    const again = await post(join, null, { action: 'submit', code, details: { ...details, idNumber: '', mobilePhone: '+972501234567' } })
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ reason: 'already' })
    const newCode = await openForm(s, { renew: true })
    expect((await post(join, null, { action: 'submit', code: newCode, details: { ...details, mobilePhone: '0529999999' } })).status).toBe(409)

    // Added to the list: still blocked. Thrown away: may send again.
    let [sub] = (await (await post(join, s, { action: 'list' })).json()).submissions
    await post(join, s, { action: 'remove', id: sub.id })
    expect((await post(join, null, { action: 'submit', code: newCode, details })).status).toBe(409)
    store.delete('join:sent')
    await post(join, null, { action: 'submit', code: newCode, details })
    ;[sub] = (await (await post(join, s, { action: 'list' })).json()).submissions
    await post(join, s, { action: 'remove', id: sub.id, allowAgain: true })
    expect((await post(join, null, { action: 'submit', code: newCode, details })).status).toBe(200)
  })
})

describe('one-time codes', () => {
  it('matches the RFC 6238 test values', async () => {
    const secret = new Uint8Array(new TextEncoder().encode('12345678901234567890'))
    expect(await codeAt(secret, Math.floor(59 / 30), 8)).toBe('94287082')
    expect(await codeAt(secret, Math.floor(1111111109 / 30), 8)).toBe('07081804')
    expect(await codeAt(secret, Math.floor(2000000000 / 30), 8)).toBe('69279037')
  })
})

describe('sessions and two-step sign-in', () => {
  beforeEach(async () => {
    store.set('allowed', new Set(['deputy@example.com']))
    store.set('owner:refresh', await seal(KEY, 'refresh-1'))
    google.tokenAnswer = { access_token: 'owner-access', expires_in: 3600 }
  })
  const tokenFor = async (s: string) => {
    google.tokenAnswer = { access_token: 'owner-access', expires_in: 3600 }
    return (await post(token, s)).json()
  }

  it('refuses the old cookie format, so everyone signs in again once', async () => {
    const old = await seal(KEY, { email: 'deputy@example.com', iat: Date.now() })
    expect(await tokenFor(old)).toEqual({ reason: 'no-session' })
  })

  it('gives nothing before the code, then works once the app is set up', async () => {
    const s = cookieValue(await signInAs('deputy@example.com'), '__Host-session')!
    const before = await post(token, s)
    expect(before.status).toBe(401)
    expect(await before.json()).toMatchObject({ reason: 'mfa-required', enrolled: false, email: 'deputy@example.com' })
    expect((await post(owner, s, { action: 'list' })).status).toBe(401)
    expect((await post(join, s, { action: 'list' })).status).toBe(401)

    const { secret, uri } = await (await post(mfa, s, { action: 'setup' })).json()
    expect(uri).toContain(`secret=${secret}`)
    expect(store.get('mfa-setup:deputy@example.com')).not.toContain(secret)
    expect((await post(mfa, s, { action: 'enable', code: '000000' })).status).toBe(400)
    const ok = await post(mfa, s, { action: 'enable', code: await codeAt(fromBase32(secret), currentStep()) })
    const { recoveryCodes } = await ok.json()
    expect(recoveryCodes).toHaveLength(10)
    expect(store.get('mfa:deputy@example.com')).not.toContain(secret)
    expect(await tokenFor(s)).toMatchObject({ accessToken: 'owner-access' })
  })

  it('a second device types a code; a used code, a wrong one and a used backup code are refused', async () => {
    await managerSession('deputy@example.com')
    const secret = fromBase32(phones.get('deputy@example.com')!)
    const s = cookieValue(await signInAs('deputy@example.com'), '__Host-session')!
    expect(await (await post(token, s)).json()).toMatchObject({ reason: 'mfa-required', enrolled: true })
    // Already set up: a device without a code cannot swap in another phone.
    expect((await post(mfa, s, { action: 'setup' })).status).toBe(409)
    expect((await post(mfa, s, { action: 'verify', code: '123456' })).status).toBe(400)
    const used = await codeAt(secret, currentStep())
    expect((await post(mfa, s, { action: 'verify', code: used })).status).toBe(400) // used by enable
    const next = await codeAt(secret, currentStep() + 1)
    expect((await post(mfa, s, { action: 'verify', code: next })).status).toBe(200)
    expect(await tokenFor(s)).toMatchObject({ accessToken: 'owner-access' })

    const backup = recovery.get('deputy@example.com')![0]
    const s2 = cookieValue(await signInAs('deputy@example.com'), '__Host-session')!
    expect(await (await post(mfa, s2, { action: 'verify', code: backup.toLowerCase() })).json()).toEqual({ ok: true, recoveryLeft: 9 })
    const s3 = cookieValue(await signInAs('deputy@example.com'), '__Host-session')!
    expect((await post(mfa, s3, { action: 'verify', code: backup })).status).toBe(400)
  })

  it('stops guessing after a few tries', async () => {
    await managerSession('deputy@example.com')
    const s = cookieValue(await signInAs('deputy@example.com'), '__Host-session')!
    // 8 tries in 15 minutes, the setup code included.
    for (let i = 0; i < 7; i++) expect((await post(mfa, s, { action: 'verify', code: '111111' })).status).toBe(400)
    expect((await post(mfa, s, { action: 'verify', code: '111111' })).status).toBe(429)
  })

  it('signing out ends the session on the server, not just the cookie', async () => {
    const s = await managerSession('deputy@example.com')
    await post(logout, s)
    expect(await tokenFor(s)).toEqual({ reason: 'no-session' })
  })

  it('a new sign-in on the same device ends the old session', async () => {
    const old = await managerSession('deputy@example.com')
    const s = await start(new Request(`${ORIGIN}/api/auth/start`))
    const state = new URL(s.headers.get('location')!).searchParams.get('state')!
    google.tokenAnswer = { id_token: idToken('deputy@example.com'), access_token: 'a', expires_in: 3600 }
    await callback(
      new Request(`${ORIGIN}/api/auth/callback?state=${state}&code=c`, {
        headers: { cookie: `__Host-oauth=${cookieValue(s, '__Host-oauth')}; __Host-session=${old}` },
      }),
    )
    expect(await tokenFor(old)).toEqual({ reason: 'no-session' })
  })

  it('sign out everywhere ends every device of that person only', async () => {
    const a = await managerSession('deputy@example.com')
    const b = await managerSession('deputy@example.com')
    const boss = await managerSession(OWNER)
    const res = await post(mfa, a, { action: 'logout-all' })
    expect(res.headers.getSetCookie()[0]).toMatch(/^__Host-session=; Max-Age=0/)
    expect(await tokenFor(a)).toEqual({ reason: 'no-session' })
    expect(await tokenFor(b)).toEqual({ reason: 'no-session' })
    expect(await tokenFor(boss)).toMatchObject({ accessToken: 'owner-access' })
  })

  it('removing an email signs it out everywhere and forgets its phone', async () => {
    const deputy = await managerSession('deputy@example.com')
    const boss = await managerSession(OWNER)
    await post(owner, boss, { action: 'remove', email: 'deputy@example.com' })
    expect(await tokenFor(deputy)).toEqual({ reason: 'no-session' })
    expect(store.has('mfa:deputy@example.com')).toBe(false)
  })

  it('the owner resets a manager who lost the phone; nobody else can', async () => {
    const deputy = await managerSession('deputy@example.com')
    expect((await post(mfa, deputy, { action: 'reset', email: OWNER })).status).toBe(403)
    const boss = await managerSession(OWNER)
    expect((await post(mfa, boss, { action: 'reset', email: 'deputy@example.com' })).status).toBe(200)
    expect(await tokenFor(deputy)).toEqual({ reason: 'no-session' })
    const s = cookieValue(await signInAs('deputy@example.com'), '__Host-session')!
    expect(await (await post(token, s)).json()).toMatchObject({ reason: 'mfa-required', enrolled: false })
  })

  it('replacing a working Drive link needs a verified owner device', async () => {
    const s = await start(new Request(`${ORIGIN}/api/auth/start?mode=owner`))
    const state = new URL(s.headers.get('location')!).searchParams.get('state')!
    google.tokenAnswer = { id_token: idToken(OWNER), refresh_token: 'attacker', access_token: 'a', scope: OWNER_SCOPES }
    const res = await callback(
      new Request(`${ORIGIN}/api/auth/callback?state=${state}&code=c`, { headers: { cookie: `__Host-oauth=${cookieValue(s, '__Host-oauth')}` } }),
    )
    expect(res.headers.get('location')).toBe('/?signin=failed')
    expect(await open(KEY, store.get('owner:refresh') as string)).toBe('refresh-1')
  })

  it('limits the public workers form per address', async () => {
    const s = await managerSession('deputy@example.com')
    const lists = { roles: [], certifications: [], departments: [] }
    const { code } = await (await post(join, s, { action: 'open', lists })).json()
    const tries: number[] = []
    for (let i = 0; i < 16; i++) {
      const mobilePhone = `05012345${String(i).padStart(2, '0')}`
      tries.push((await post(join, null, { action: 'submit', code, details: { firstName: 'a', lastName: 'b', mobilePhone } })).status)
    }
    expect(tries.slice(0, 15).every((t) => t === 200)).toBe(true)
    expect(tries[15]).toBe(429)
  })

  it('refuses a body that is too big', async () => {
    const s = await managerSession(OWNER)
    expect((await post(owner, s, { action: 'list', pad: 'x'.repeat(9000) })).status).toBe(400)
    expect((await post(mfa, s, { action: 'status', pad: 'x'.repeat(9000) })).status).toBe(400)
  })
})
