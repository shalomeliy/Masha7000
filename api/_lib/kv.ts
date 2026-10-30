import { createClient } from 'redis'
import type { Env } from './env.js'

// The server's small store: Upstash over its REST API, or a plain Redis connection (REDIS_URL,
// Vercel Marketplace "Redis"). Holds only: the owner's sealed refresh token, a sealed cached
// access token, the allowed emails.

export const KEYS = {
  refresh: 'owner:refresh',
  access: 'owner:access',
  allowed: 'allowed',
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
}
