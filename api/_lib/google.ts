import { callbackUrl, type Env } from './env.js'

// Google's OAuth code flow (PKCE + state). Everyone signs in with "openid email" only, to prove
// who they are. The owner, once, also grants the app's Drive folder and calendar with offline access;
// that refresh token is what lets the server open the owner's Drive for everyone allowed.

export const IDENTITY_SCOPES = 'openid email'
export const OWNER_SCOPES =
  'openid email https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/calendar.app.created'

export type Mode = 'identity' | 'owner'

export const hasOwnerScopes = (granted: string | undefined) =>
  OWNER_SCOPES.split(' ')
    .filter((s) => s.startsWith('https://'))
    .every((s) => (granted ?? '').split(' ').includes(s))

export function authUrl(env: Env, mode: Mode, state: string, challenge: string, loginHint?: string) {
  const p = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: callbackUrl(env),
    response_type: 'code',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(mode === 'owner'
      ? { scope: OWNER_SCOPES, access_type: 'offline', prompt: 'consent', login_hint: env.ownerEmail }
      : { scope: IDENTITY_SCOPES, prompt: 'select_account', ...(loginHint ? { login_hint: loginHint } : {}) }),
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`
}

interface TokenAnswer {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  id_token?: string
  scope?: string
  error?: string
}

async function tokenCall(env: Env, params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, ...params }),
  })
  return { ok: res.ok, data: (await res.json()) as TokenAnswer }
}

export const exchangeCode = (env: Env, code: string, verifier: string) =>
  tokenCall(env, { code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: callbackUrl(env) })

export const refreshAccess = (env: Env, refreshToken: string) =>
  tokenCall(env, { refresh_token: refreshToken, grant_type: 'refresh_token' })

export async function revoke(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {})
}

/**
 * The verified email inside the ID token. The token came straight from Google's token endpoint
 * over TLS in exchange for our code, so per OpenID Connect its signature need not be re-checked.
 */
export function emailOf(idToken: string | undefined): string | null {
  try {
    const claims = JSON.parse(Buffer.from(idToken!.split('.')[1], 'base64url').toString()) as {
      email?: string
      email_verified?: boolean
    }
    return claims.email && claims.email_verified !== false ? claims.email.toLowerCase() : null
  } catch {
    return null
  }
}
