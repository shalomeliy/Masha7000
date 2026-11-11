import { open, randomToken, seal, sha256url } from './crypto.js'
import type { Env } from './env.js'
import { KEYS, kv } from './kv.js'

// Keys for the outside API (/api/v1). Only the owner makes and revokes them (api/api-keys.ts).
// A key is shown once, when it is made; the store keeps only its SHA-256, and under that the sealed
// record of what it may do. A request finds its record by the hash of the key it sent, so a key that
// was revoked (record deleted) stops working at once. Personal fields of workers (ID numbers,
// phones, address, birth date) leave only through a key made with `personal`.

export type Scope = 'read' | 'write'

export interface ApiKey {
  id: string
  name: string
  scopes: Scope[]
  personal: boolean
  createdAt: string // ISO time
}

export interface ApiKeyRow extends ApiKey {
  lastUsed: string | null
}

export interface ApiCall {
  at: string // ISO time
  keyId: string | null // null: no key or a wrong one
  method: string
  path: string
  status: number
}

const PREFIX = 'm7k_'
const MAX_KEYS = 20
const LOG_KEEP = 500
const NAME_MAX = 60

export const cleanName = (raw: unknown) => (typeof raw === 'string' ? raw.trim().slice(0, NAME_MAX) : '')

/** Makes a key; answers the key itself (shown once) and its record. Null when there are too many keys already. */
export async function createKey(env: Env, input: { name: string; scopes: Scope[]; personal: boolean }): Promise<{ key: string; record: ApiKey } | null> {
  if ((await kv.members(env, KEYS.apiKeys)).length >= MAX_KEYS) return null
  const key = PREFIX + randomToken(32)
  const hash = await sha256url(key)
  const record: ApiKey = {
    id: randomToken(9),
    name: input.name,
    scopes: input.scopes.includes('write') ? ['read', 'write'] : ['read'],
    personal: input.personal,
    createdAt: new Date().toISOString(),
  }
  await kv.set(env, KEYS.apiKey(hash), await seal(env.sessionKey, record))
  await kv.add(env, KEYS.apiKeys, hash)
  return { key, record }
}

async function records(env: Env): Promise<{ hash: string; record: ApiKey }[]> {
  const hashes = await kv.members(env, KEYS.apiKeys)
  const all = await Promise.all(hashes.map(async (hash) => ({ hash, record: await open<ApiKey>(env.sessionKey, await kv.get(env, KEYS.apiKey(hash))) })))
  return all.filter((r): r is { hash: string; record: ApiKey } => r.record !== null)
}

export async function listKeys(env: Env): Promise<ApiKeyRow[]> {
  const all = await records(env)
  const rows = await Promise.all(all.map(async ({ record }) => ({ ...record, lastUsed: await kv.get(env, KEYS.apiKeyUsed(record.id)) })))
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Revokes the key with this id; false when there is none. */
export async function revokeKey(env: Env, id: string): Promise<boolean> {
  const found = (await records(env)).find((r) => r.record.id === id)
  if (!found) return false
  await kv.del(env, KEYS.apiKey(found.hash), KEYS.apiKeyUsed(id))
  await kv.remove(env, KEYS.apiKeys, found.hash)
  return true
}

/** The record of the key in `Authorization: Bearer <key>`, or null (none, malformed, unknown or revoked). */
export async function keyOf(env: Env, req: Request): Promise<ApiKey | null> {
  const said = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!said.startsWith(PREFIX) || said.length > 100) return null
  return open<ApiKey>(env.sessionKey, await kv.get(env, KEYS.apiKey(await sha256url(said))))
}

export async function markUsed(env: Env, id: string) {
  await kv.set(env, KEYS.apiKeyUsed(id), new Date().toISOString())
}

export async function logCall(env: Env, call: ApiCall) {
  await kv.pushKeep(env, KEYS.apiLog, JSON.stringify(call), LOG_KEEP)
}

export async function readLog(env: Env, count = 100): Promise<ApiCall[]> {
  const raw = await kv.list(env, KEYS.apiLog, count)
  return raw.flatMap((r) => {
    try {
      return [JSON.parse(r) as ApiCall]
    } catch {
      return []
    }
  })
}
