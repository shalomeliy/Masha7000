import { createClient } from 'redis'
import type { Env } from './env.js'

// The server's small store: Upstash over its REST API, or a plain Redis connection (REDIS_URL,
// Vercel Marketplace "Redis"). Holds only: the owner's sealed refresh token, a sealed cached
// access token, the allowed emails, the workers' details form and its sealed answers, the weekly constraints form and its sealed answers, the sealed
// sign-in sessions, each person's sealed two-step secret, short-lived rate-limit counters, the
// voice assistant's spending this month (budget.ts), and the sealed log of what went to Claude (claudeLog.ts).

export const KEYS = {
  refresh: 'owner:refresh',
  access: 'owner:access',
  allowed: 'allowed',
  joinForm: 'join:form',
  joinSubs: 'join:subs',
  joinSent: 'join:sent',
  /** The weekly constraints form (sealed), the workers' sealed answers, and "<week>|<workerId>" of who answered. */
  consForm: 'cons:form',
  consSubs: 'cons:subs',
  consAnswered: 'cons:answered',
  /** When a worker first answered a week (ms), for the two-hour window to fix it. */
  consFirst: (week: string, workerId: string) => `cons:first:${week}:${workerId}`,
  /** The phone (a random id it keeps) that first answered a week for a worker: another phone's answer waits for the manager. */
  consDevice: (week: string, workerId: string) => `cons:device:${week}:${workerId}`,
  /** A worker's last answer, sealed, behind the token their phone keeps: the form opens with it. */
  consEdit: (token: string) => `cons:edit:${token}`,
  /** sess:<sid> = one signed-in device; sessions:<email> = that person's sids. */
  session: (sid: string) => `sess:${sid}`,
  sessionsOf: (email: string) => `sessions:${email}`,
  /** mfa:<email> = the person's two-step secret; mfa-setup:<email> = one being set up (15 minutes). */
  mfa: (email: string) => `mfa:${email}`,
  mfaSetup: (email: string) => `mfa-setup:${email}`,
  rate: (bucket: string, id: string) => `rl:${bucket}:${id}`,
  /** The sealed "what went to Claude" log (claudeLog.ts). */
  claudeLog: 'claude-log',
  /** A code already used: a 30-second step, or a backup code's hash. */
  mfaUsed: (email: string, what: string) => `mfa-used:${email}:${what}`,
} as const

type Arg = string | number

async function rest<T>(env: Env, args: Arg[]): Promise<T> {
  const res = await fetch(env.kvUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.kvToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args.map(String)),
  })
  if (!res.ok) throw new Error(`KV ${res.status}`)
  return ((await res.json()) as { result: T }).result
}

// One connection per warm function instance, opened on first use.
let tcp: Promise<ReturnType<typeof createClient>> | null = null
function connection(url: string) {
  tcp ??= (async () => {
    const client = createClient({ url })
    client.on('error', () => {}) // a dropped connection reconnects; a failed command still throws
    await client.connect()
    return client
  })().catch((e) => {
    tcp = null
    throw e
  })
  return tcp
}

async function command<T>(env: Env, ...args: Arg[]): Promise<T> {
  if (env.kvToken !== 'tcp') return rest<T>(env, args)
  const client = await connection(env.kvUrl)
  return (await client.sendCommand(args.map(String))) as T
}

export const kv = {
  get: (env: Env, key: string) => command<string | null>(env, 'GET', key),
  set: (env: Env, key: string, value: string, exSeconds?: number) =>
    exSeconds ? command(env, 'SET', key, value, 'EX', exSeconds) : command(env, 'SET', key, value),
  del: (env: Env, ...keys: string[]) => command(env, 'DEL', ...keys),
  members: (env: Env, key: string) => command<string[]>(env, 'SMEMBERS', key),
  isMember: async (env: Env, key: string, value: string) => Number(await command<number>(env, 'SISMEMBER', key, value)) === 1,
  add: (env: Env, key: string, value: string) => command(env, 'SADD', key, value),
  remove: (env: Env, key: string, value: string) => command(env, 'SREM', key, value),
  /** Sets the key only if it is not there yet; true when this call got it (atomic, for one-time use). */
  claim: async (env: Env, key: string, exSeconds: number) => (await command<string | null>(env, 'SET', key, '1', 'NX', 'EX', exSeconds)) === 'OK',
  incr: async (env: Env, key: string) => Number(await command<number>(env, 'INCR', key)),
  incrBy: async (env: Env, key: string, by: number) => Number(await command<number>(env, 'INCRBY', key, Math.round(by))),
  /** Sets the key only if it is not there yet (keeps the first value). */
  setNew: (env: Env, key: string, value: string, exSeconds: number) => command(env, 'SET', key, value, 'NX', 'EX', exSeconds),
  expire: (env: Env, key: string, seconds: number) => command(env, 'EXPIRE', key, seconds),
}
