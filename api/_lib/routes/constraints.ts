import { open, randomToken, seal } from '../crypto.js'
import { cleanAnswer, cleanRoster, deviceOf, isWeekStart, phoneDigits, type ConstraintAnswer, type RosterEntry } from '../constraintForm.js'
import { readEnv, type Env } from '../env.js'
import { clientIp, guarded, json, readJson, sameOrigin } from '../http.js'
import { kv } from '../kv.js'
import { overLimit } from '../rate.js'
import { requireManager } from '../session.js'
import { linkFormCode, teamKeys, teamOfFormCode, unlinkFormCode } from '../team.js'

// The weekly constraints form. A manager opens it for a week and shares one link (/constraints/<code>)
// in the workers' WhatsApp group. A worker, not signed in to anything, types their mobile number
// and the days they cannot work. The number picks the worker from the roster the manager's app
// sent; an unknown number is refused. Answers wait here, sealed, until a manager's app writes them
// into that worker's constraints (in the owner's Drive) and removes them.
//
// GET  /api/constraints?c=<code>                         public: the week, or 404 when closed
// POST /api/constraints { action: 'submit', code, phone, days, notes }   public
// POST /api/constraints { action: 'open' | 'close' | 'list' | 'accept' | 'remove', ... }   signed-in managers
//
// A worker may send again for the same week (to fix it) for two hours after their first answer:
// the new answer replaces the earlier one. Each answer gives the phone a token; opening the form
// with it shows the answer already sent, so it can be fixed instead of filled again.
// Each team has its own form and answers (api/_lib/team.ts): a manager's actions use his session's
// team; a public link finds its team only from the server's record of that code.

interface Form {
  code: string
  weekStart: string
  roster: RosterEntry[]
}

export const MAX_ANSWERS = 1000
export const EDIT_WINDOW_MS = 2 * 60 * 60 * 1000
const FIRST_DAYS = 21 // the first answer's time is kept this long (the week is long over by then)
const EDIT_DAYS = 8 // the answer behind the phone's token, shown when the form is opened again

interface Edit {
  workerId: string
  firstName: string
  weekStart: string
  days: string[]
  notes?: string
  until: number // last moment a fix is taken
}
type Keys = ReturnType<typeof teamKeys>
const readEdit = async (env: Env, keys: Keys, token: unknown) =>
  typeof token === 'string' && /^[\w-]{16,64}$/.test(token) ? open<Edit>(env.sessionKey, await kv.get(env, keys.consEdit(token))) : null
const MAX_BODY = 64_000 // the roster of a big team

const readForm = async (env: Env, keys: Keys) => open<Form>(env.sessionKey, await kv.get(env, keys.consForm))

async function readAnswers(env: Env, keys: Keys) {
  const sealed = await kv.members(env, keys.consSubs)
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
  const keys = teamKeys(await teamOfFormCode(env, 'cons', code))
  const form = await readForm(env, keys)
  if (!form || !code || code !== form.code) return json({ reason: 'closed' }, 404)
  // The answer this phone already sent for this week, when it holds the token for it.
  const edit = await readEdit(env, keys, new URL(req.url).searchParams.get('t'))
  const mine = edit && edit.weekStart === form.weekStart && form.roster.some((r) => r.id === edit.workerId) ? edit : null
  return json({ weekStart: form.weekStart, ...(mine ? { mine: { firstName: mine.firstName, days: mine.days, notes: mine.notes ?? '', until: mine.until } } : {}) })
})

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  const body = await readJson(req, MAX_BODY)
  if (!body) return json({ reason: 'bad-body' }, 400)

  if (body.action === 'submit') {
    if (await overLimit(env, 'consSubmit', clientIp(req))) return json({ reason: 'too-many' }, 429)
    const keys = teamKeys(await teamOfFormCode(env, 'cons', body.code))
    const form = await readForm(env, keys)
    if (!form || body.code !== form.code) return json({ reason: 'closed' }, 404)
    const worker = form.roster.find((r) => r.phone === phoneDigits(body.phone))
    if (!worker) return json({ reason: 'unknown-phone' }, 404)
    const cleaned = cleanAnswer(body)
    if (!cleaned) return json({ reason: 'bad-days' }, 400)
    const now = Date.now()
    // The phone that first answered this week for this worker is theirs. An answer from another phone
    // (someone typing a colleague's number, or the worker on a new phone) does not go in by itself: it
    // waits for the manager to accept or remove it (code scan 2026-11-10, the user's choice).
    const device = deviceOf(body.device) || '-'
    const deviceKey = keys.consDevice(form.weekStart, worker.id)
    await kv.setNew(env, deviceKey, device, FIRST_DAYS * 86_400)
    if ((await kv.get(env, deviceKey)) !== device) {
      const waiting = await readAnswers(env, keys)
      const earlier = waiting.filter((o) => o.answer.disputed && o.answer.workerId === worker.id && o.answer.weekStart === form.weekStart)
      if (waiting.length - earlier.length >= MAX_ANSWERS) return json({ reason: 'full' }, 429)
      const answer: ConstraintAnswer = { id: randomToken(9), at: now, workerId: worker.id, weekStart: form.weekStart, ...cleaned, disputed: true, device }
      await kv.add(env, keys.consSubs, await seal(env.sessionKey, answer))
      for (const o of earlier) await kv.remove(env, keys.consSubs, o.sealed)
      const until = now + EDIT_WINDOW_MS
      const kept = await readEdit(env, keys, body.token)
      const token = kept && kept.workerId === worker.id && kept.weekStart === form.weekStart ? (body.token as string) : randomToken(18)
      await kv.set(env, keys.consEdit(token), await seal(env.sessionKey, { workerId: worker.id, firstName: worker.firstName, weekStart: form.weekStart, ...cleaned, until } satisfies Edit), EDIT_DAYS * 86_400)
      return json({ ok: true, firstName: worker.firstName, token, until, review: true })
    }
    // Fixing is open for two hours from the first answer to this week, then locked.
    const firstKey = keys.consFirst(form.weekStart, worker.id)
    await kv.setNew(env, firstKey, String(now), FIRST_DAYS * 86_400)
    const first = Number(await kv.get(env, firstKey)) || now
    const until = first + EDIT_WINDOW_MS
    if (now > until) return json({ reason: 'locked', until }, 409)
    const waiting = await readAnswers(env, keys)
    // A second answer for the same week replaces the first, if the manager's app has not taken it yet.
    const earlier = waiting.filter((o) => !o.answer.disputed && o.answer.workerId === worker.id && o.answer.weekStart === form.weekStart)
    if (waiting.length - earlier.length >= MAX_ANSWERS) return json({ reason: 'full' }, 429)
    const answer: ConstraintAnswer = { id: randomToken(9), at: now, workerId: worker.id, weekStart: form.weekStart, ...cleaned }
    await kv.add(env, keys.consSubs, await seal(env.sessionKey, answer))
    for (const o of earlier) await kv.remove(env, keys.consSubs, o.sealed)
    await kv.add(env, keys.consAnswered, answeredMark(form.weekStart, worker.id))
    // The same token while it is this worker's answer to this week; a new one otherwise.
    const kept = await readEdit(env, keys, body.token)
    const token = kept && kept.workerId === worker.id && kept.weekStart === form.weekStart ? (body.token as string) : randomToken(18)
    const edit: Edit = { workerId: worker.id, firstName: worker.firstName, weekStart: form.weekStart, ...cleaned, until }
    await kv.set(env, keys.consEdit(token), await seal(env.sessionKey, edit), EDIT_DAYS * 86_400)
    return json({ ok: true, firstName: worker.firstName, token, until })
  }

  // Everything else is a manager's.
  if (await overLimit(env, 'consManage', clientIp(req))) return json({ reason: 'too-many' }, 429)
  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate.refuse
  const teamId = gate.team.id
  const keys = teamKeys(teamId)

  switch (body.action) {
    case 'open': {
      if (!isWeekStart(body.weekStart)) return json({ reason: 'bad-week' }, 400)
      // Opening again keeps the same link (already in the group), moves it to the week asked for, and
      // refreshes the roster. Old weeks' "who answered" marks are dropped.
      const current = await readForm(env, keys)
      const code = current && body.renew !== true ? current.code : randomToken(12)
      if (current && current.code !== code) await unlinkFormCode(env, 'cons', current.code)
      await kv.set(env, keys.consForm, await seal(env.sessionKey, { code, weekStart: body.weekStart, roster: cleanRoster(body.roster) } satisfies Form))
      await linkFormCode(env, 'cons', code, teamId)
      for (const m of await kv.members(env, keys.consAnswered)) if (m.split('|')[0] < body.weekStart) await kv.remove(env, keys.consAnswered, m)
      return json({ code })
    }
    case 'close':
      await unlinkFormCode(env, 'cons', (await readForm(env, keys))?.code)
      await kv.del(env, keys.consForm)
      return json({ code: null })
    case 'list': {
      const form = await readForm(env, keys)
      // The phone's id stays here: the app only needs to know an answer is disputed.
      const answers = (await readAnswers(env, keys)).map(({ answer: { device: _device, ...a } }) => a).sort((a, b) => a.at - b.at)
      const week = form?.weekStart
      const answered = week ? (await kv.members(env, keys.consAnswered)).filter((m) => m.startsWith(`${week}|`)).map((m) => m.slice(week.length + 1)) : []
      return json({ code: form?.code ?? null, weekStart: week ?? null, answered, answers })
    }
    case 'accept': {
      // The manager says a disputed answer is the worker's own: it goes in like any answer, its phone
      // becomes the worker's phone for this week, and fixing is open for two hours from now.
      const found = (await readAnswers(env, keys)).find((o) => o.answer.id === body.id && o.answer.disputed)
      if (!found) return json({ ok: true })
      const { disputed: _d, device, ...answer } = found.answer
      await kv.add(env, keys.consSubs, await seal(env.sessionKey, answer))
      await kv.remove(env, keys.consSubs, found.sealed)
      if (device) await kv.set(env, keys.consDevice(answer.weekStart, answer.workerId), device, FIRST_DAYS * 86_400)
      await kv.set(env, keys.consFirst(answer.weekStart, answer.workerId), String(Date.now()), FIRST_DAYS * 86_400)
      return json({ ok: true })
    }
    case 'remove': {
      // The manager's app wrote these into the workers' constraints.
      const ids = new Set(Array.isArray(body.ids) ? body.ids.filter((x: unknown): x is string => typeof x === 'string') : [])
      for (const o of await readAnswers(env, keys)) if (ids.has(o.answer.id)) await kv.remove(env, keys.consSubs, o.sealed)
      return json({ ok: true })
    }
    default:
      return json({ reason: 'bad-action' }, 400)
  }
})
