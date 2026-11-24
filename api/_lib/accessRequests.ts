import { open, seal, sha256url } from './crypto.js'
import type { Env } from './env.js'
import type { FeedbackMail } from './feedback.js'
import { kv } from './kv.js'
import { createTeam, emailTaken, type TeamRecord } from './team.js'

// "לקוח חדש? בקש גישה" (smart onboarding part 2). Someone Google signed in but who is in no team
// asks the owner for access: business name and WhatsApp. The email is never typed: it is the one
// Google verified, sealed in a 30-minute cookie by the sign-in callback. One record per email
// (areq:<hash>, a second request replaces the first), at most MAX_REQUESTS waiting. The owner
// approves (a new team, api/_lib/team.ts) or rejects in Settings > מי יכול להיכנס.

export const MAX_REQUESTS = 200
const DAYS = 30

export interface AccessRequest {
  email: string
  businessName: string
  whatsapp: string
  at: string
}

const LIST = 'access-requests'
const recordKey = async (email: string) => `areq:${await sha256url(email)}`

/** Business name and WhatsApp as stored, or the field that is wrong. */
export function cleanRequest(raw: Record<string, unknown>): { businessName: string; whatsapp: string } | { reason: 'name' | 'whatsapp' } {
  const businessName = typeof raw.businessName === 'string' ? raw.businessName.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
  if (businessName.length < 2) return { reason: 'name' }
  const whatsapp = String(raw.whatsapp ?? '').replace(/\D/g, '').replace(/^972/, '0')
  if (!/^05\d{8}$/.test(whatsapp)) return { reason: 'whatsapp' }
  return { businessName, whatsapp }
}

/**
 * Keeps the request. 'stored' when it waits for the owner now; 'skipped' when the email is already in
 * a team or the list is full. The caller answers the same either way (no hint about other emails).
 */
export async function storeRequest(env: Env, email: string, details: { businessName: string; whatsapp: string }): Promise<'stored' | 'skipped'> {
  if (email === env.ownerEmail || (await emailTaken(env, email))) return 'skipped'
  const key = await recordKey(email)
  const known = await kv.isMember(env, LIST, key)
  if (!known && (await kv.members(env, LIST)).length >= MAX_REQUESTS) {
    // Full: first drop the ones whose record expired (30 days), so old entries never block new customers.
    await listRequests(env)
    if ((await kv.members(env, LIST)).length >= MAX_REQUESTS) return 'skipped'
  }
  const req: AccessRequest = { email, ...details, at: new Date().toISOString() }
  await kv.set(env, key, await seal(env.sessionKey, req), DAYS * 86_400)
  await kv.add(env, LIST, key)
  return 'stored'
}

export async function hasRequest(env: Env, email: string) {
  return kv.isMember(env, LIST, await recordKey(email))
}

export async function listRequests(env: Env): Promise<AccessRequest[]> {
  const keys = await kv.members(env, LIST)
  const all = await Promise.all(keys.map(async (k) => ({ k, r: await open<AccessRequest>(env.sessionKey, await kv.get(env, k)) })))
  // A record that expired: off the list too.
  for (const { k, r } of all) if (!r) await kv.remove(env, LIST, k)
  return all.flatMap(({ r }) => (r ? [r] : [])).sort((a, b) => a.at.localeCompare(b.at))
}

export async function rejectRequest(env: Env, email: string) {
  const key = await recordKey(email)
  await kv.del(env, key)
  await kv.remove(env, LIST, key)
}

/** The owner approved: a new team for that email (null when there is no such request, or the email is taken). */
export async function approveRequest(env: Env, email: string, maxManagers: number): Promise<TeamRecord | null> {
  const req = await open<AccessRequest>(env.sessionKey, await kv.get(env, await recordKey(email)))
  if (!req || req.email !== email) return null
  const rec = await createTeam(env, { owner: email, maxManagers, businessName: req.businessName, whatsapp: req.whatsapp })
  if (rec) await rejectRequest(env, email)
  return rec
}

/** Plain text only, so nothing typed in the form turns into markup in the mail. */
export function requestMail(r: AccessRequest, to: string, from: string): FeedbackMail {
  return {
    from,
    to: [to],
    reply_to: r.email,
    subject: `Shali - בקשת גישה: ${r.businessName.slice(0, 60)}`,
    text: `לקוח חדש מבקש גישה.\n\nעסק: ${r.businessName}\nמייל (אומת בגוגל): ${r.email}\nוואטסאפ: ${r.whatsapp}\n${r.at}\n\nלאישור: הגדרות > גישה ואבטחה > מי יכול להיכנס > בקשות גישה.`,
  }
}
