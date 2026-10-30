import { open, seal } from './crypto.js'
import type { Env } from './env.js'
import { KEYS, kv } from './kv.js'
import { readCookie, SESSION_COOKIE, SESSION_DAYS, setCookie } from './http.js'

// A signed-in person = a sealed { email } cookie, 180 days. Whether they may still get in is
// checked on every token request, so removing an email from the list takes effect within the hour.

interface Session {
  email: string
  iat: number
}

export async function sessionCookie(env: Env, email: string) {
  const value = await seal(env.sessionKey, { email, iat: Date.now() } satisfies Session)
  return setCookie(SESSION_COOKIE, value, SESSION_DAYS * 24 * 3600)
}

export async function readSession(env: Env, req: Request): Promise<Session | null> {
  const s = await open<Session>(env.sessionKey, readCookie(req, SESSION_COOKIE))
  return s && typeof s.email === 'string' && Date.now() - s.iat < SESSION_DAYS * 24 * 3600 * 1000 ? s : null
}

export const isOwner = (env: Env, email: string) => email === env.ownerEmail

export async function isAllowed(env: Env, email: string) {
  return isOwner(env, email) || kv.isMember(env, KEYS.allowed, email)
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const normalizeEmail = (raw: unknown) => {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return EMAIL.test(email) ? email : null
}
