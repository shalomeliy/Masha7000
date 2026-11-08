import { open, randomToken, seal } from './_lib/crypto.js'
import { cleanAnswer, cleanRoster, isWeekStart, phoneDigits, type ConstraintAnswer, type RosterEntry } from './_lib/constraintForm.js'
import { readEnv, type Env } from './_lib/env.js'
import { clientIp, guarded, json, readJson, sameOrigin } from './_lib/http.js'
import { KEYS, kv } from './_lib/kv.js'
import { overLimit } from './_lib/rate.js'
import { requireManager } from './_lib/session.js'

// The weekly constraints form. A manager opens it for a week and shares one link (/constraints/<code>)
// in the workers' WhatsApp group. A worker, not signed in to anything, types their mobile number
// and the days they cannot work. The number picks the worker from the roster the manager's app
// sent; an unknown number is refused. Answers wait here, sealed, until a manager's app writes them
// into that worker's constraints (in the owner's Drive) and removes them.
//
// GET  /api/constraints?c=<code>                         public: the week, or 404 when closed
// POST /api/constraints { action: 'submit', code, phone, days, notes }   public
// POST /api/constraints { action: 'open' | 'close' | 'list' | 'remove', ... }   signed-in managers
//
// A worker may send again for the same week (to fix it): the new answer replaces the one waiting.

interface Form {
  code: string
  weekStart: string
  roster: RosterEntry[]
}

export const MAX_ANSWERS = 1000
const MAX_BODY = 64_000 // the roster of a big team

const readForm = async (env: Env) => open<Form>(env.sessionKey, await kv.get(env, KEYS.consForm))

async function readAnswers(env: Env) {
  const sealed = await kv.members(env, KEYS.consSubs)
  const opened = await Promise.all(sealed.map(async (s) => ({ sealed: s, answer: await open<ConstraintAnswer>(env.sessionKey, s) })))
  return opened.filter((o): o is { sealed: string; answer: ConstraintAnswer } => o.answer !== null)
}

// Who answered which week: "<week>|<workerId>", so the manager sees who has not answered yet.
const answeredMark = (week: string, workerId: string) => `${week}|${workerId}`

export const GET = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (await overLimit(env, 'consRead', clientIp(req))) return json({ reason: 'too-many' }, 429)
  const code = new URL(req.url).searchParams.get('c')
  const form = await readForm(env)
  if (!form || !code || code !== form.code) return json({ reason: 'closed' }, 404)
  return json({ weekStart: form.weekStart })
})

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  const body = await readJson(req, MAX_BODY)
  if (!body) return json({ reason: 'bad-body' }, 400)

  if (body.action === 'submit') {
    if (await overLimit(env, 'consSubmit', clientIp(req))) return json({ reason: 'too-many' }, 429)
    const form = await readForm(env)
    if (!form || body.code !== form.code) return json({ reason: 'closed' }, 404)
    const worker = form.roster.find((r) => r.phone === phoneDigits(body.phone))
    if (!worker) return json({ reason: 'unknown-phone' }, 404)
    const cleaned = cleanAnswer(body)
    if (!cleaned) return json({ reason: 'bad-days' }, 400)
    const waiting = await readAnswers(env)
    // A second answer for the same week replaces the first, if the manager's app has not taken it yet.
    const earlier = waiting.filter((o) => o.answer.workerId === worker.id && o.answer.weekStart === form.weekStart)
    if (waiting.length - earlier.length >= MAX_ANSWERS) return json({ reason: 'full' }, 429)
    const answer: ConstraintAnswer = { id: randomToken(9), at: Date.now(), workerId: worker.id, weekStart: form.weekStart, ...cleaned }
    await kv.add(env, KEYS.consSubs, await seal(env.sessionKey, answer))
    for (const o of earlier) await kv.remove(env, KEYS.consSubs, o.sealed)
    await kv.add(env, KEYS.consAnswered, answeredMark(form.weekStart, worker.id))
    return json({ ok: true, firstName: worker.firstName })
  }

  // Everything else is a manager's.
  if (await overLimit(env, 'consManage', clientIp(req))) return json({ reason: 'too-many' }, 429)
  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate.refuse

  switch (body.action) {
    case 'open': {
      if (!isWeekStart(body.weekStart)) return json({ reason: 'bad-week' }, 400)
      // Opening again keeps the same link (already in the group), moves it to the week asked for, and
      // refreshes the roster. Old weeks' "who answered" marks are dropped.
      const current = await readForm(env)
      const code = current && body.renew !== true ? current.code : randomToken(12)
      await kv.set(env, KEYS.consForm, await seal(env.sessionKey, { code, weekStart: body.weekStart, roster: cleanRoster(body.roster) } satisfies Form))
      for (const m of await kv.members(env, KEYS.consAnswered)) if (m.split('|')[0] < body.weekStart) await kv.remove(env, KEYS.consAnswered, m)
      return json({ code })
    }
    case 'close':
      await kv.del(env, KEYS.consForm)
      return json({ code: null })
    case 'list': {
      const form = await readForm(env)
      const answers = (await readAnswers(env)).map((o) => o.answer).sort((a, b) => a.at - b.at)
      const week = form?.weekStart
      const answered = week ? (await kv.members(env, KEYS.consAnswered)).filter((m) => m.startsWith(`${week}|`)).map((m) => m.slice(week.length + 1)) : []
      return json({ code: form?.code ?? null, weekStart: week ?? null, answered, answers })
    }
    case 'remove': {
      // The manager's app wrote these into the workers' constraints.
      const ids = new Set(Array.isArray(body.ids) ? body.ids.filter((x: unknown): x is string => typeof x === 'string') : [])
      for (const o of await readAnswers(env)) if (ids.has(o.answer.id)) await kv.remove(env, KEYS.consSubs, o.sealed)
      return json({ ok: true })
    }
    default:
      return json({ reason: 'bad-action' }, 400)
  }
})
