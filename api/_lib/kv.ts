import type { Env } from './env.js'

// Upstash Redis over its REST API (added to the Vercel project from the Marketplace).
// Holds only: the owner's sealed refresh token, a sealed cached access token, the allowed emails.

export const KEYS = {
  refresh: 'owner:refresh',
  access: 'owner:access',
  allowed: 'allowed',
} as const

async function command<T>(env: Env, ...args: (string | number)[]): Promise<T> {
  const res = await fetch(env.kvUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.kvToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args.map(String)),
  })
  if (!res.ok) throw new Error(`KV ${res.status}`)
  return ((await res.json()) as { result: T }).result
}

export const kv = {
  get: (env: Env, key: string) => command<string | null>(env, 'GET', key),
  set: (env: Env, key: string, value: string, exSeconds?: number) =>
    exSeconds ? command(env, 'SET', key, value, 'EX', exSeconds) : command(env, 'SET', key, value),
  del: (env: Env, ...keys: string[]) => command(env, 'DEL', ...keys),
  members: (env: Env, key: string) => command<string[]>(env, 'SMEMBERS', key),
  isMember: async (env: Env, key: string, value: string) => (await command<number>(env, 'SISMEMBER', key, value)) === 1,
  add: (env: Env, key: string, value: string) => command(env, 'SADD', key, value),
  remove: (env: Env, key: string, value: string) => command(env, 'SREM', key, value),
}
