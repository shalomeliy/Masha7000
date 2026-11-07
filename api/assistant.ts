import { assistantStream, validConversation } from './_lib/assistant.js'
import { readEnv } from './_lib/env.js'
import { clientIp, guarded, json, readJson, sameOrigin } from './_lib/http.js'
import { overLimit } from './_lib/rate.js'
import { isOwner, requireManager } from './_lib/session.js'

// POST /api/assistant { messages, context }: one turn of the voice assistant, for the owner only,
// answered as JSON lines (an early spoken part, then the whole reply)
// (the user's rule: only the owner's account may spend the Anthropic credit). The key stays here.

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  if (await overLimit(env, 'assistant', clientIp(req))) return json({ reason: 'too-many' }, 429)
  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate.refuse
  if (!isOwner(env, gate.session.email)) return json({ reason: 'not-owner' }, 403)
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim()
  if (!apiKey) return json({ reason: 'no-key' }, 503)

  const body = await readJson(req, 400_000)
  if (!body) return json({ reason: 'bad-body' }, 400)
  if (!validConversation(body.messages) || !body.context || typeof body.context !== 'object') return json({ reason: 'bad-body' }, 400)
  // Streamed: the spoken part goes out as soon as it is written (see assistantStream).
  return new Response(assistantStream(apiKey, body.messages, body.context, process.env.ASSISTANT_MODEL), {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
})
