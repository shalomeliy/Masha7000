import { open, seal } from './crypto.js'
import type { Env } from './env.js'
import { clientIp } from './http.js'
import { KEYS, kv } from './kv.js'

// The security log (ISO 27001 A.8.15): who signed in, wrong two-step codes, and every change to who
// may get in, with the time and a shortened address. The owner reads it in Settings > אבטחה.
// Each line is sealed (it holds emails), the newest AUDIT_KEEP are kept, and nothing here holds a
// code, token or cookie. Writing it never breaks the request it records.

export const AUDIT_KEEP = 1000

export type AuditEvent =
  | 'signin'
  | 'signin-refused'
  | 'mfa-ok'
  | 'mfa-wrong'
  | 'mfa-locked'
  | 'mfa-enrolled'
  | 'mfa-reset'
  | 'recovery-used'
  | 'recovery-new'
  | 'logout-all'
  | 'access-add'
  | 'access-remove'
  | 'assistant-access'
  | 'drive-connect'
  | 'drive-disconnect'
  | 'apikey-create'
  | 'apikey-revoke'

export interface AuditEntry {
  at: string
  event: AuditEvent
  /** Who did it (or tried to). */
  email?: string
  /** Whom or what it was about: an email, a key's name. */
  target?: string
  /** The address, shortened: enough to tell places apart, not to point at one home. */
  ip?: string
}

/** 203.0.113.57 -> 203.0.113.x; an IPv6 address keeps its first four groups. */
export function shortIp(ip: string) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.replace(/\.\d+$/, '.x')
  if (ip.includes(':')) return `${ip.split(':').slice(0, 4).join(':')}::x`
  return 'unknown'
}

export async function audit(env: Env, req: Request | null, event: AuditEvent, who: { email?: string; target?: string } = {}) {
  try {
    const entry: AuditEntry = { at: new Date().toISOString(), event, ...who, ...(req ? { ip: shortIp(clientIp(req)) } : {}) }
    await kv.pushKeep(env, KEYS.audit, await seal(env.sessionKey, entry), AUDIT_KEEP)
  } catch {
    console.error('audit write failed', event)
  }
}

export async function readAudit(env: Env, count = 300): Promise<AuditEntry[]> {
  const raw = await kv.list(env, KEYS.audit, count)
  const entries = await Promise.all(raw.map((r) => open<AuditEntry>(env.sessionKey, r)))
  return entries.filter((e): e is AuditEntry => !!e)
}
