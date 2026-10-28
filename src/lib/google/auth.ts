import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './config'

// Browser-only OAuth via the GIS token model: no backend, no refresh token.
// The access token (about 1 hour) is kept in localStorage so a page reload or an app
// update reuses it. After it expires the user clicks once; because the account is
// remembered, Google skips the consent screen and the popup closes by itself.

interface Token {
  value: string
  expiresAt: number
}

const TOKEN_KEY = 'shiftsmart.token'
const ACCOUNT_KEY = 'shiftsmart.account'

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

let token: Token | null = readStored<Token>(TOKEN_KEY)
let client: google.accounts.oauth2.TokenClient | null = null
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null

function setToken(next: Token | null) {
  token = next
  writeStored(TOKEN_KEY, next)
}

export function rememberedAccount(): Account | null {
  return readStored<Account>(ACCOUNT_KEY)
}

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
 * Opens the Google popup. Must be called from a user click (browsers block popups otherwise).
 * First time: full consent screen. After that: a popup that closes by itself.
 */
export async function signIn(): Promise<string> {
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

export function signOut() {
  if (token) google.accounts.oauth2.revoke(token.value)
  setToken(null)
  writeStored(ACCOUNT_KEY, null)
}

export class AuthExpiredError extends Error {}

/** fetch wrapper that adds the bearer token and turns API errors into exceptions. */
export async function googleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const access = getAccessToken()
  if (!access) throw new AuthExpiredError('Not signed in or session expired')
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${access}`)
  const res = await fetch(url, { ...init, headers })
  if (res.status === 401) {
    setToken(null)
    throw new AuthExpiredError('Session expired')
  }
  if (!res.ok) throw new Error(`Google API ${res.status}: ${await res.text()}`)
  return res
}
