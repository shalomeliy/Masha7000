import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './config'

// Browser-only OAuth via the GIS token model: no backend, no refresh token.
// The access token lives in memory only and is re-requested when it expires.

interface Token {
  value: string
  expiresAt: number
}

let token: Token | null = null
let client: google.accounts.oauth2.TokenClient | null = null
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null

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
        token = { value: res.access_token, expiresAt: Date.now() + (res.expires_in - 60) * 1000 }
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

/** Opens the Google consent popup. Must be called from a user click. */
export async function signIn(): Promise<string> {
  const c = await getClient()
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    c.requestAccessToken({ prompt: token ? '' : 'consent' })
  })
}

export function getAccessToken(): string | null {
  if (!token || Date.now() >= token.expiresAt) return null
  return token.value
}

export function signOut() {
  if (token) google.accounts.oauth2.revoke(token.value)
  token = null
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
    token = null
    throw new AuthExpiredError('Session expired')
  }
  if (!res.ok) throw new Error(`Google API ${res.status}: ${await res.text()}`)
  return res
}
