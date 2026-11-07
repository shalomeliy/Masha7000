import { assistantStream, pickModel, validConversation, type AssistantReply } from './_lib/assistant.js'
import { readBudget, recordSpend } from './_lib/budget.js'
import { readEnv, type Env } from './_lib/env.js'
import { clientIp, guarded, json, readJson, sameOrigin } from './_lib/http.js'
import { overLimit } from './_lib/rate.js'
import { isOwner, requireManager } from './_lib/session.js'

// POST /api/assistant { messages, context }: one turn of the voice assistant, for the owner only,
// answered as JSON lines (an early spoken part, then the whole reply)
// (the user's rule: only the owner's account may spend the Anthropic credit). The key stays here.
// GET /api/assistant: how much of this month's budget the assistant has used (budget.ts).

// Configured, not too many, signed in as the owner. (A same-site GET carries no Origin header,
// so only the POST, which spends money, also checks it.)
async function ownerGate(req: Request): Promise<{ env: Env } | { refuse: Response }> {
  const env = readEnv()
  if (!env) return { refuse: json({ reason: 'not-configured' }, 503) }
  if (req.method === 'POST' && !sameOrigin(req, env.appOrigin)) return { refuse: json({ reason: 'bad-origin' }, 403) }
  if (await overLimit(env, 'assistant', clientIp(req))) return { refuse: json({ reason: 'too-many' }, 429) }
  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate
  if (!isOwner(env, gate.session.email)) return { refuse: json({ reason: 'not-owner' }, 403) }
  return { env }
}

export const GET = guarded(async (req: Request) => {
  const gate = await ownerGate(req)
  if ('refuse' in gate) return gate.refuse
  return json({ budget: await readBudget(gate.env) })
})

export const POST = guarded(async (req: Request) => {
  const gate = await ownerGate(req)
  if ('refuse' in gate) return gate.refuse
  const { env } = gate
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim()
  if (!apiKey) return json({ reason: 'no-key' }, 503)

  const body = await readJson(req, 400_000)
  if (!body) return json({ reason: 'bad-body' }, 400)
  if (!validConversation(body.messages) || !body.context || typeof body.context !== 'object') return json({ reason: 'bad-body' }, 400)
  // After each answer its cost is added to the month, and the new total goes back with it.
  const after = async (reply: AssistantReply) => {
    if (reply.ok) await recordSpend(env, pickModel(process.env.ASSISTANT_MODEL), reply.usage)
    return { budget: await readBudget(env) }
  }
  // Streamed: the spoken part goes out as soon as it is written (see assistantStream).
  return new Response(assistantStream(apiKey, body.messages, body.context, process.env.ASSISTANT_MODEL, false, after), {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
})
