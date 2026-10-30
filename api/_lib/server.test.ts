import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { open, seal } from './crypto.js'
import { readEnv } from './env.js'
import { authUrl, OWNER_SCOPES } from './google.js'
import { GET as start } from '../auth/start.js'
import { GET as callback } from '../auth/callback.js'
import { POST as token } from '../token.js'
import { POST as owner } from '../owner.js'
import { POST as logout } from '../logout.js'

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
    return cookieValue(await signInAs(email), '__Host-session')!
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
    expect(await (await post(token, null)).json()).toEqual({ reason: 'not-configured' })
  })
})

describe('owner controls', () => {
  it('only the owner can change the list', async () => {
    store.set('allowed', new Set(['deputy@example.com']))
    store.set('owner:refresh', await seal(KEY, 'refresh-1'))
    const deputy = cookieValue(await signInAs('deputy@example.com'), '__Host-session')!
    expect((await post(owner, deputy, { action: 'add', email: 'x@example.com' })).status).toBe(403)

    const boss = cookieValue(await signInAs(OWNER), '__Host-session')!
    const added = await post(owner, boss, { action: 'add', email: ' New@Example.com ' })
    expect(await added.json()).toEqual({ owner: OWNER, emails: ['deputy@example.com', 'new@example.com'] })
    expect((await post(owner, boss, { action: 'add', email: 'not an email' })).status).toBe(400)
    await post(owner, boss, { action: 'remove', email: 'deputy@example.com' })
    expect(await (await post(owner, boss, { action: 'list' })).json()).toEqual({ owner: OWNER, emails: ['new@example.com'] })
  })

  it('disconnect revokes the Drive token at Google', async () => {
    store.set('owner:refresh', await seal(KEY, 'refresh-1'))
    const boss = cookieValue(await signInAs(OWNER), '__Host-session')!
    await post(owner, boss, { action: 'disconnect' })
    expect(google.revoked).toEqual(['refresh-1'])
    expect(store.has('owner:refresh')).toBe(false)
  })

  it('logout clears only the session cookie', async () => {
    const res = await post(logout, null)
    expect(res.headers.getSetCookie()[0]).toMatch(/^__Host-session=; Max-Age=0/)
  })
})
