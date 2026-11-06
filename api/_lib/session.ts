import { open, randomToken, seal } from './crypto.js'
import type { Env } from './env.js'
import { KEYS, kv } from './kv.js'
import { json, readCookie, SESSION_COOKIE, SESSION_DAYS, setCookie } from './http.js'

// A signed-in device = a sealed { sid } cookie plus a sealed record in the store, 180 days.
// The record is what counts: signing out, "sign out everywhere", or the owner removing an email
// deletes it, and the cookie stops working at once. Whether the email may still get in is checked
// on every request too. A record starts unverified: until the person types a two-step code
// (mfa: true) it only reaches the two-step endpoint.
// The cookie format changed with two-step sign-in: the old { email } cookies open to nothing,
// so everyone signs in again once.

const MAX_AGE_MS = SESSION_DAYS * 24 * 3600 * 1000

interface SessionRecord {
  email: string
  iat: number
  mfa: boolean
}

export interface Session extends SessionRecord {
  sid: string
}

async function save(env: Env, s: Session) {
  const left = Math.ceil((s.iat + MAX_AGE_MS - Date.now()) / 1000)
  if (left <= 0) return
  await kv.set(env, KEYS.session(s.sid), await seal(env.sessionKey, { email: s.email, iat: s.iat, mfa: s.mfa } satisfies SessionRecord), left)
}

/** A new, not yet verified session for this email; returns its Set-Cookie line. */
export async function createSession(env: Env, email: string) {
  const s: Session = { sid: randomToken(24), email, iat: Date.now(), mfa: false }
  await save(env, s)
  await kv.add(env, KEYS.sessionsOf(email), s.sid)
  return setCookie(SESSION_COOKIE, await seal(env.sessionKey, { sid: s.sid }), SESSION_DAYS * 24 * 3600)
}

export async function readSession(env: Env, req: Request): Promise<Session | null> {
  const cookie = await open<{ sid?: unknown }>(env.sessionKey, readCookie(req, SESSION_COOKIE))
  if (!cookie || typeof cookie.sid !== 'string') return null
  const rec = await open<SessionRecord>(env.sessionKey, await kv.get(env, KEYS.session(cookie.sid)))
  if (!rec || typeof rec.email !== 'string' || Date.now() - rec.iat >= MAX_AGE_MS) return null
  return { sid: cookie.sid, email: rec.email, iat: rec.iat, mfa: rec.mfa === true }
}

/** The person typed a right two-step code on this device. */
export const markVerified = (env: Env, s: Session) => save(env, { ...s, mfa: true })

export async function endSession(env: Env, s: Pick<Session, 'sid' | 'email'>) {
  await kv.del(env, KEYS.session(s.sid))
  await kv.remove(env, KEYS.sessionsOf(s.email), s.sid)
}

/** Signs this email out on every device. `except` keeps one session (the one asking). */
export async function endAllSessions(env: Env, email: string, except?: string) {
  const sids = await kv.members(env, KEYS.sessionsOf(email))
  const gone = sids.filter((sid) => sid !== except)
  if (gone.length) await kv.del(env, ...gone.map(KEYS.session))
  for (const sid of gone) await kv.remove(env, KEYS.sessionsOf(email), sid)
}

export const isOwner = (env: Env, email: string) => email === env.ownerEmail

export async function isAllowed(env: Env, email: string) {
  return isOwner(env, email) || kv.isMember(env, KEYS.allowed, email)
}

export const hasMfa = async (env: Env, email: string) => (await kv.get(env, KEYS.mfa(email))) !== null

/**
 * The signed-in, still allowed, two-step verified person, or the answer that refuses them.
 * 'mfa-required' says whether they still need to set up the app (enrolled: false) or just type a code.
 */
export async function requireManager(env: Env, req: Request): Promise<{ session: Session } | { refuse: Response }> {
  const session = await readSession(env, req)
  if (!session) return { refuse: json({ reason: 'no-session' }, 401) }
  if (!(await isAllowed(env, session.email))) return { refuse: json({ reason: 'not-allowed' }, 403) }
  if (!session.mfa) {
    const who = { email: session.email, isOwner: isOwner(env, session.email) }
    return { refuse: json({ reason: 'mfa-required', enrolled: await hasMfa(env, session.email), ...who }, 401) }
  }
  return { session }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const normalizeEmail = (raw: unknown) => {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return email.length <= 254 && EMAIL.test(email) ? email : null
}
