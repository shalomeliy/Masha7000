import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Fresh module each test: auth.ts keeps the mode and token in module state.
const load = () => import('./auth')

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function stubFetch(handler: Handler) {
  const fn = vi.fn((input: string | URL | Request, init?: RequestInit) => Promise.resolve(handler(String(input), init)))
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('resume', () => {
  it('uses the browser-only sign-in when there is no server (local dev)', async () => {
    stubFetch(() => new Response('<html>', { status: 404 }))
    const auth = await load()
    expect(await auth.resume()).toEqual({ status: 'signedOut' })
    expect(auth.authMode()).toBe('popup')
  })

  it('uses the browser-only sign-in while the server is not set up', async () => {
    stubFetch(() => json({ reason: 'not-configured' }, 503))
    const auth = await load()
    await auth.resume()
    expect(auth.authMode()).toBe('popup')
  })

  it('a server crash page is a failure, never a switch to the own Drive', async () => {
    stubFetch(() => new Response('A server error has occurred', { status: 500 }))
    const auth = await load()
    expect(await auth.resume()).toEqual({ status: 'failed' })
    expect(auth.authMode()).not.toBe('server')
    stubFetch(() => json({ accessToken: 't', expiresIn: 3600, email: 'a@x.com', isOwner: false }))
    await auth.resume()
    stubFetch(() => json({ reason: 'server-error' }, 500))
    expect(await auth.resume()).toEqual({ status: 'failed' })
    expect(auth.authMode()).toBe('server')
  })

  it('is signed in through the server with no click', async () => {
    stubFetch(() => json({ accessToken: 'owner-token', expiresIn: 3600, email: 'deputy@x.com', isOwner: false }))
    const auth = await load()
    expect(await auth.resume()).toEqual({ status: 'signedIn', who: { email: 'deputy@x.com', isOwner: false } })
    expect(auth.authMode()).toBe('server')
    expect(auth.getAccessToken()).toBe('owner-token')
  })

  it('tells apart a removed email and a disconnected owner', async () => {
    stubFetch(() => json({ reason: 'not-allowed' }, 403))
    expect((await (await load()).resume()).status).toBe('notAllowed')
    vi.resetModules()
    stubFetch(() => json({ reason: 'owner-disconnected', email: 'boss@x.com', isOwner: true }, 409))
    expect(await (await load()).resume()).toEqual({ status: 'ownerDisconnected', who: { email: 'boss@x.com', isOwner: true } })
  })
})

describe('googleFetch in server mode', () => {
  it('renews once after a 401 and retries the call', async () => {
    let tokens = 0
    let driveCalls = 0
    stubFetch((url, init) => {
      if (url === '/api/token') return json({ accessToken: `t${++tokens}`, expiresIn: 3600, email: 'a@x.com', isOwner: true })
      driveCalls++
      return new Headers(init?.headers).get('Authorization') === 'Bearer t2' ? json({ ok: 1 }) : json({}, 401)
    })
    const auth = await load()
    await auth.resume()
    const res = await auth.googleFetch('https://www.googleapis.com/drive/v3/files')
    expect(await res.json()).toEqual({ ok: 1 })
    expect(tokens).toBe(2)
    expect(driveCalls).toBe(2)
  })

  it('throws the reason when the server refuses the renewal', async () => {
    let first = true
    stubFetch((url) => {
      if (url === '/api/token') {
        if (first) return (first = false), json({ accessToken: 't1', expiresIn: 3600, email: 'a@x.com', isOwner: false })
        return json({ reason: 'not-allowed' }, 403)
      }
      return json({}, 401)
    })
    const auth = await load()
    await auth.resume()
    await expect(auth.googleFetch('https://www.googleapis.com/x')).rejects.toMatchObject({ reason: 'not-allowed' })
  })

  it('offline is not a sign-out', async () => {
    stubFetch((url) => {
      if (url === '/api/token') return json({ accessToken: 't1', expiresIn: 3600, email: 'a@x.com', isOwner: false })
      throw new TypeError('Failed to fetch')
    })
    const auth = await load()
    await auth.resume()
    await expect(auth.googleFetch('https://www.googleapis.com/x')).rejects.toBeInstanceOf(auth.OfflineError)
    expect(auth.getAccessToken()).toBe('t1')
  })
})
