import { open, seal } from './crypto.js'
import type { Env } from './env.js'
import { KEYS, kv } from './kv.js'

// The "what went to Claude" log (src/lib/claudeLog.ts writes it): one sealed list in the store, the
// last LOG_MAX conversations, kept 120 days after the last write. It holds what the manager said
// (worker names, places), so it is sealed like everything else here and read only by the owner.

export const LOG_MAX = 300
const KEEP_SECONDS = 120 * 24 * 3600
const OUTCOMES = ['pending', 'answered', 'confirmed', 'cancelled', 'failed'] as const

export interface LogEntry {
  id: string
  at: string
  lang: string
  said: string[]
  reason: string
  understood: string
  did: string[]
  outcome: (typeof OUTCOMES)[number]
  learned: string
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const lines = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 20).map((x) => x.slice(0, max)) : [])

/** A log entry from the browser, cut to size; null when it is not one. */
export function logEntry(v: unknown): LogEntry | null {
  if (!v || typeof v !== 'object') return null
  const e = v as Record<string, unknown>
  const id = text(e.id, 64)
  const at = text(e.at, 40)
  if (!/^[\w-]{4,64}$/.test(id) || Number.isNaN(Date.parse(at))) return null
  const outcome = OUTCOMES.find((o) => o === e.outcome) ?? 'pending'
  return {
    id,
    at,
    lang: text(e.lang, 8),
    said: lines(e.said, 400),
    reason: text(e.reason, 400),
    understood: text(e.understood, 400),
    did: lines(e.did, 500),
    outcome,
    learned: text(e.learned, 20),
  }
}

/** The list with this entry added, or put in place of the one with its id; oldest dropped past LOG_MAX. */
export function withEntry(list: LogEntry[], e: LogEntry): LogEntry[] {
  const i = list.findIndex((x) => x.id === e.id)
  const next = i >= 0 ? list.map((x, k) => (k === i ? e : x)) : [...list, e]
  return next.slice(-LOG_MAX)
}

export async function readLog(env: Env): Promise<LogEntry[]> {
  return (await open<LogEntry[]>(env.sessionKey, await kv.get(env, KEYS.claudeLog))) ?? []
}

export async function addToLog(env: Env, e: LogEntry) {
  await kv.set(env, KEYS.claudeLog, await seal(env.sessionKey, withEntry(await readLog(env), e)), KEEP_SECONDS)
}

export const clearStoredLog = (env: Env) => kv.del(env, KEYS.claudeLog)

/**
 * A development session's key for reading the log without signing in (Vercel env CLAUDE_LOG_TOKEN,
 * at least 32 characters; unset = only the signed-in owner can read it). Compared in constant time.
 */
export function tokenMatches(req: Request, token = (process.env.CLAUDE_LOG_TOKEN ?? '').trim()): boolean {
  if (token.length < 32) return false
  const said = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  const a = Buffer.from(said)
  const b = Buffer.from(token)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]
  return diff === 0
}
