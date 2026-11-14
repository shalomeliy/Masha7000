import { assistantStream, pickModel, validConversation, type AssistantReply } from './_lib/assistant.js'
import { readBudget, recordSpend } from './_lib/budget.js'
import { readEnv, type Env } from './_lib/env.js'
import { clientIp, guarded, json, readJson, sameOrigin } from './_lib/http.js'
import { overLimit } from './_lib/rate.js'
import { canUseAssistant, isOwner, requireManager } from './_lib/session.js'
import { mp3, readTtsRequest, synthesize, takeChars } from './_lib/tts.js'

// POST /api/assistant { messages, context }: one turn of the voice assistant, for the owner only,
// answered as JSON lines (an early spoken part, then the whole reply)
// (the user's rule: the budget is the owner's alone; a manager the owner opened Shali to in Settings
// uses only the free commands, and is told 'free-only'). The key stays here.
// POST /api/assistant?tts { text, voice, rate }: one sentence in Shali's cloud voice, as MP3 (tts.ts), for
// the owner and the managers he opened Shali to (it costs nothing within Google's free monthly amount).
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
  const email = gate.session.email
  if (!isOwner(env, email)) return { refuse: json({ reason: (await canUseAssistant(env, email)) ? 'free-only' : 'not-owner' }, 403) }
  return { env }
}

export const GET = guarded(async (req: Request) => {
  const gate = await ownerGate(req)
  if ('refuse' in gate) return gate.refuse
  return json({ budget: await readBudget(gate.env) })
})

// The cloud voice: the same checks, its own rate bucket (a reply is several sentences), and any manager
// who may use Shali, also the free-only ones. Every refusal means "speak with the phone's voice".
async function speakSentence(req: Request): Promise<Response> {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  if (await overLimit(env, 'tts', clientIp(req))) return json({ reason: 'too-many' }, 429)
  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate.refuse
  const email = gate.session.email
  if (!isOwner(env, email) && !(await canUseAssistant(env, email))) return json({ reason: 'not-owner' }, 403)
  const apiKey = (process.env.GOOGLE_TTS_API_KEY ?? '').trim()
  if (!apiKey) return json({ reason: 'no-key' }, 503)
  const tts = readTtsRequest(await readJson(req, 4_000))
  if (!tts) return json({ reason: 'bad-body' }, 400)
  if (!(await takeChars(env, tts.text.length))) return json({ reason: 'over-budget' }, 402)
  try {
    return mp3(await synthesize(apiKey, tts))
  } catch (e) {
    console.error('tts failed', (e as Error).message?.slice(0, 200))
    return json({ reason: 'tts-failed' }, 502)
  }
}

export const POST = guarded(async (req: Request) => {
  if (new URL(req.url).searchParams.has('tts')) return speakSentence(req)
  const gate = await ownerGate(req)
  if ('refuse' in gate) return gate.refuse
  const { env } = gate
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim()
  if (!apiKey) return json({ reason: 'no-key' }, 503)

  const body = await readJson(req, 400_000)
  if (!body) return json({ reason: 'bad-body' }, 400)
  if (!validConversation(body.messages) || !body.context || typeof body.context !== 'object') return json({ reason: 'bad-body' }, 400)
  // The month's cap is kept here too, not only by the Anthropic account's limit (code scan 2026-11-10):
  // once the counted spending reaches it, nothing is sent until the next month.
  const budget = await readBudget(env)
  if (budget.spentUsd >= budget.limitUsd) return json({ reason: 'over-budget', budget }, 402)
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
