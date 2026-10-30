import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './config'

// Two ways to reach Google:
// - Server mode (the live site once set up): our /api keeps the owner's Google refresh token and
//   hands out 1-hour access tokens to anyone signed in and allowed, so everyone works on the owner's
//   Drive and stays signed in for months. The access token lives in memory only.
// - Popup mode (local dev, or before the server is set up): the browser-only GIS token model.
//   A 1-hour token kept in localStorage; after it expires the user clicks once.
// resume() finds out which one applies by asking /api/token.

interface Token {
  value: string
  expiresAt: number
}

export type AuthReason = 'expired' | 'no-session' | 'not-allowed' | 'owner-disconnected'
export class AuthExpiredError extends Error {
  reason: AuthReason
  constructor(message: string, reason: AuthReason = 'expired') {
    super(message)
    this.reason = reason
  }
}
/** No internet: not a sign-out. */
export class OfflineError extends Error {}

export interface Who {
  email: string
  isOwner: boolean
}

const TOKEN_KEY = 'shiftsmart.token'
const ACCOUNT_KEY = 'shiftsmart.account'
const MODE_KEY = 'shiftsmart.mode'

function readStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeStored(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage blocked (private mode): fall back to memory only.
  }
}

/** The Google account that signed in before, so renewal skips consent and account choice. */
interface Account {
  email?: string
}

let mode: 'server' | 'popup' = readStored<string>(MODE_KEY) === 'server' ? 'server' : 'popup'
let token: Token | null = mode === 'popup' ? readStored<Token>(TOKEN_KEY) : null
let who: Who | null = null
let client: google.accounts.oauth2.TokenClient | null = null
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null

function setToken(next: Token | null) {
  token = next
  if (mode === 'popup') writeStored(TOKEN_KEY, next)
}

export const authMode = () => mode
export const currentUser = () => who

export function rememberedAccount(): Account | null {
  return readStored<Account>(ACCOUNT_KEY)
}

// ---- Server mode ----

type ServerAnswer =
  | { kind: 'token'; accessToken: string; expiresIn: number; email: string; isOwner: boolean }
  | { kind: 'refused'; reason: AuthReason; who?: Who }
  | { kind: 'no-server' }
  | { kind: 'failed' }

async function askServer(stale = false): Promise<ServerAnswer> {
  let res: Response
  // A hung server must not leave "מתחבר..." spinning forever.
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 10_000)
  try {
    res = await fetch('/api/token', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stale }),
      signal: abort.signal,
    })
  } catch {
    if (abort.signal.aborted) return { kind: 'failed' }
    throw new OfflineError('No connection')
  } finally {
    clearTimeout(timer)
  }
  // No /api at all (Vite dev, or the server code removed): browser-only sign-in.
  if (res.status === 404) return { kind: 'no-server' }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  // A crash or timeout page is a failure, never a reason to switch to the person's own Drive.
  if (!body) return { kind: 'failed' }
  if (body.reason === 'not-configured') return { kind: 'no-server' }
  if (res.ok && typeof body.accessToken === 'string') return { kind: 'token', ...(body as Omit<Extract<ServerAnswer, { kind: 'token' }>, 'kind'>) }
  const reason = body.reason as string
  if (reason === 'no-session' || reason === 'not-allowed' || reason === 'owner-disconnected') {
    const w = typeof body.email === 'string' ? { email: body.email, isOwner: body.isOwner === true } : undefined
    return { kind: 'refused', reason, who: w }
  }
  return { kind: 'failed' }
}

function enterServerMode() {
  if (mode !== 'server') writeStored(TOKEN_KEY, null) // an old browser-only token is no longer used
  mode = 'server'
  writeStored(MODE_KEY, 'server')
}

function enterPopupMode() {
  mode = 'popup'
  writeStored(MODE_KEY, null)
}

let renewing: Promise<string> | null = null

/**
 * A fresh owner token from the server; one request at a time however many calls need it.
 * stale: Google refused the token we have, so the server must not hand back its cached copy.
 */
function renew(stale = false): Promise<string> {
  renewing ??= (async () => {
    try {
      const answer = await askServer(stale)
      if (answer.kind === 'token') {
        who = { email: answer.email, isOwner: answer.isOwner }
        setToken({ value: answer.accessToken, expiresAt: Date.now() + (answer.expiresIn - 60) * 1000 })
        return answer.accessToken
      }
      if (answer.kind === 'refused') throw new AuthExpiredError(answer.reason, answer.reason)
      throw new Error('Sign-in server failed')
    } finally {
      renewing = null
    }
  })()
  return renewing
}

export type ResumeResult =
  | { status: 'signedIn'; who: Who | null }
  | { status: 'signedOut' | 'notAllowed' | 'ownerDisconnected' | 'failed'; who?: Who }

/** At app start: is someone signed in, and through which mode? Never opens a popup. */
export async function resume(): Promise<ResumeResult> {
  let answer: ServerAnswer
  try {
    answer = await askServer()
  } catch {
    // Offline at start: trust the last known state; Drive calls will show the offline message.
    return mode === 'server' || getAccessToken() ? { status: 'signedIn', who } : { status: 'signedOut' }
  }
  if (answer.kind === 'no-server') {
    enterPopupMode()
    return getAccessToken() ? { status: 'signedIn', who: null } : { status: 'signedOut' }
  }
  if (answer.kind === 'failed') return { status: 'failed' }
  enterServerMode()
  if (answer.kind === 'token') {
    who = { email: answer.email, isOwner: answer.isOwner }
    setToken({ value: answer.accessToken, expiresAt: Date.now() + (answer.expiresIn - 60) * 1000 })
    return { status: 'signedIn', who }
  }
  who = answer.who ?? null
  const status = answer.reason === 'not-allowed' ? 'notAllowed' : answer.reason === 'owner-disconnected' ? 'ownerDisconnected' : 'signedOut'
  return { status, who: answer.who }
}

/** Server mode: the owner grants Drive access again (after a disconnect). */
export function ownerReconnect() {
  window.location.assign('/api/auth/start?mode=owner')
}

// ---- Popup mode ----

function waitForGis(timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const check = () => {
      if (window.google?.accounts?.oauth2) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('Google sign-in script did not load'))
      setTimeout(check, 100)
    }
    check()
  })
}

async function getClient() {
  if (client) return client
  if (!GOOGLE_CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID is not set (see .env.example)')
  await waitForGis()
  client = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: (res) => {
      if (res.error || !res.access_token) {
        pending?.reject(new Error(res.error_description || res.error || 'Sign-in failed'))
      } else {
        // Renew a minute early so a request never goes out with a token about to expire.
        setToken({ value: res.access_token, expiresAt: Date.now() + (res.expires_in - 60) * 1000 })
        pending?.resolve(res.access_token)
      }
      pending = null
    },
    error_callback: (err) => {
      pending?.reject(new Error(err.message || err.type))
      pending = null
    },
  })
  return client
}

/** Best effort: learn the signed-in email so the next renewal can name the account. */
async function rememberAccount(access: string) {
  const prev = rememberedAccount()
  writeStored(ACCOUNT_KEY, { email: prev?.email })
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
      headers: { Authorization: `Bearer ${access}` },
    })
    if (!res.ok) return
    const email = ((await res.json()) as { user?: { emailAddress?: string } }).user?.emailAddress
    if (email) writeStored(ACCOUNT_KEY, { email })
  } catch {
    // Without the email, renewal still works; Google may just show the account chooser.
  }
}

/**
 * Server mode: the whole page goes to Google and comes back signed in (never resolves).
 * Popup mode: opens the Google popup; must be called from a user click.
 */
export async function signIn(): Promise<string> {
  if (mode === 'server') {
    const hint = who?.email ?? rememberedAccount()?.email
    window.location.assign(`/api/auth/start${hint ? `?hint=${encodeURIComponent(hint)}` : ''}`)
    return new Promise<string>(() => {})
  }
  const c = await getClient()
  const account = rememberedAccount()
  const access = await new Promise<string>((resolve, reject) => {
    pending = { resolve, reject }
    c.requestAccessToken(account ? { prompt: '', login_hint: account.email } : { prompt: 'consent' })
  })
  await rememberAccount(access)
  return access
}

export function getAccessToken(): string | null {
  if (!token || Date.now() >= token.expiresAt) return null
  return token.value
}

/** Signs out this device. In server mode other devices and the owner's Drive link stay. */
export async function signOut() {
  if (mode === 'server') {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
  } else if (token) {
    google.accounts.oauth2.revoke(token.value)
  }
  setToken(null)
  who = null
  writeStored(ACCOUNT_KEY, null)
}

async function send(url: string, init: RequestInit, access: string) {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${access}`)
  try {
    return await fetch(url, { ...init, headers })
  } catch {
    throw new OfflineError('No connection')
  }
}

/**
 * fetch wrapper that adds the bearer token and turns API errors into exceptions.
 * Server mode renews silently (no token yet, expired, or a 401) and retries once.
 */
export async function googleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let access = getAccessToken() ?? (mode === 'server' ? await renew() : null)
  if (!access) throw new AuthExpiredError('Not signed in or session expired')
  let res = await send(url, init, access)
  if (res.status === 401) {
    setToken(null)
    if (mode !== 'server') throw new AuthExpiredError('Session expired')
    access = await renew(true)
    res = await send(url, init, access)
    if (res.status === 401) throw new AuthExpiredError('Session expired')
  }
  if (!res.ok) throw new Error(`Google API ${res.status}: ${await res.text()}`)
  return res
}
