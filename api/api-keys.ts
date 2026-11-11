import { cleanName, createKey, listKeys, readLog, revokeKey, type Scope } from './_lib/apiKeys.js'
import { readEnv } from './_lib/env.js'
import { clientIp, guarded, json, readJson, sameOrigin } from './_lib/http.js'
import { overLimit } from './_lib/rate.js'
import { isOwner, requireManager } from './_lib/session.js'

// Settings > "גישת API": the owner's keys for the outside API (api/v1.ts). Owner only, from the app's own pages.
// POST { action: 'list' }                         -> { keys, log }
// POST { action: 'create', name, write, personal } -> { key, record }   (the key is shown only now)
// POST { action: 'revoke', id }                   -> { ok }

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  if (await overLimit(env, 'apiKeysManage', clientIp(req))) return json({ reason: 'too-many' }, 429)
  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate.refuse
  if (!isOwner(env, gate.session.email)) return json({ reason: 'not-owner' }, 403)

  const body = await readJson(req)
  if (!body) return json({ reason: 'bad-request' }, 400)
  switch (body.action) {
    case 'list':
      return json({ keys: await listKeys(env), log: await readLog(env) })
    case 'create': {
      const name = cleanName(body.name)
      if (!name) return json({ reason: 'no-name' }, 400)
      const scopes: Scope[] = body.write === true ? ['read', 'write'] : ['read']
      const made = await createKey(env, { name, scopes, personal: body.personal === true })
      if (!made) return json({ reason: 'too-many-keys' }, 409)
      return json(made)
    }
    case 'revoke':
      if (typeof body.id !== 'string') return json({ reason: 'bad-request' }, 400)
      return json({ ok: await revokeKey(env, body.id) })
    default:
      return json({ reason: 'bad-request' }, 400)
  }
})
