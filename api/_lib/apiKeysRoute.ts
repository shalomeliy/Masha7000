import { cleanName, createKey, listKeys, readLog, revokeKey, type Scope } from './apiKeys.js'
import type { Env } from './env.js'
import { json } from './http.js'

// Settings > "גישת API": the owner's keys for the outside API (api/v1.ts). Reached through POST /api/owner?scope=api-keys
// with { action }, after its owner-only checks. Not its own function file: the Vercel plan allows 12.
// { action: 'list' }                         -> { keys, log }
// { action: 'create', name, write, personal } -> { key, record }   (the key is shown only now)
// { action: 'revoke', id }                   -> { ok }

/** `teamId`: the caller's team, from his session (requireManager), never from the body. */
export async function apiKeysAction(env: Env, teamId: string, body: Record<string, unknown>): Promise<Response> {
  switch (body.action) {
    case 'list':
      return json({ keys: await listKeys(env, teamId), log: await readLog(env, teamId) })
    case 'create': {
      const name = cleanName(body.name)
      if (!name) return json({ reason: 'no-name' }, 400)
      const scopes: Scope[] = body.write === true ? ['read', 'write'] : ['read']
      const made = await createKey(env, teamId, { name, scopes, personal: body.personal === true })
      if (!made) return json({ reason: 'too-many-keys' }, 409)
      return json(made)
    }
    case 'revoke':
      if (typeof body.id !== 'string') return json({ reason: 'bad-request' }, 400)
      return json({ ok: await revokeKey(env, teamId, body.id) })
    default:
      return json({ reason: 'bad-request' }, 400)
  }
}
