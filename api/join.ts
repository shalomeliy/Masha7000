import { open, randomToken, seal, sha256url } from './_lib/crypto.js'
import { readEnv, type Env } from './_lib/env.js'
import { clientIp, guarded, json, readJson, sameOrigin } from './_lib/http.js'
import { KEYS, kv } from './_lib/kv.js'
import { overLimit } from './_lib/rate.js'
import { requireManager } from './_lib/session.js'

// The workers' details form. A manager opens it and shares one link (/join/<code>) in WhatsApp.
// Workers, not signed in to anything, fill it; each answer waits here, sealed, until a manager
// adds it to the workers list (which lives in the owner's Drive) or throws it away.
//
// GET  /api/join?c=<code>                      public: the form's choice lists, or 404 when closed
// POST /api/join { action: 'submit', code, details }   public: one worker's answer
// POST /api/join { action: 'open' | 'close' | 'list' | 'remove', ... }   signed-in managers
//
// One answer per person: the mobile and ID number of everyone who sent are kept (as keyed hashes,
// never the numbers), and a second answer with either is refused, even after a new link.
// Only a manager throwing an answer away (remove with allowAgain) lets that person send again.

export interface Tag {
  id: string
  name: string
}
export interface FormLists {
  certifications: Tag[]
  departments: Tag[]
}
interface Form {
  code: string
  lists: FormLists
}

export const MAX_PENDING = 200
const MAX_BODY = 16_000

const TEXT_FIELDS = {
  firstName: 40,
  lastName: 40,
  mobilePhone: 20,
  idNumber: 12,
  personalNumber: 20,
  birthDate: 10,
  address: 120,
  homePhone: 20,
  emergencyPhone1: 20,
  emergencyPhone2: 20,
  notes: 500,
} as const
type TextField = keyof typeof TEXT_FIELDS

export type Submission = { id: string; at: number; certificationIds: string[]; departmentId?: string } & {
  [K in TextField]?: string
} & { firstName: string; lastName: string; mobilePhone: string }

const isMobile = (p: string) => /^(?:05\d|\+9725\d|9725\d)\d{7}$/.test(p.replace(/[\s\-()]/g, ''))

const cleanTags = (raw: unknown): Tag[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((t): t is Tag => !!t && typeof t.id === 'string' && typeof t.name === 'string')
    .slice(0, 100)
    .map((t) => ({ id: t.id.slice(0, 64), name: t.name.trim().slice(0, 60) }))
    .filter((t) => t.id && t.name)

const cleanLists = (raw: unknown): FormLists => {
  const r = (raw ?? {}) as Partial<Record<keyof FormLists, unknown>>
  return { certifications: cleanTags(r.certifications), departments: cleanTags(r.departments) }
}

/** The answer as it will be stored: known fields only, cut to length, choices only from the form's lists. */
export function cleanDetails(raw: unknown, lists: FormLists): { details: Omit<Submission, 'id' | 'at'> } | { reason: string } {
  const r = (raw ?? {}) as Record<string, unknown>
  const text = (f: TextField) => (typeof r[f] === 'string' ? (r[f] as string).trim().slice(0, TEXT_FIELDS[f]) : '')
  const out: Record<string, unknown> = {}
  for (const f of Object.keys(TEXT_FIELDS) as TextField[]) {
    const v = text(f)
    if (v) out[f] = v
  }
  if (!out.firstName || !out.lastName) return { reason: 'name' }
  if (!isMobile(String(out.mobilePhone ?? ''))) return { reason: 'mobile' }
  if (out.idNumber && !/^\d{9}$/.test(String(out.idNumber).replace(/[\s-]/g, ''))) return { reason: 'id' }
  if (out.birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(out.birthDate))) delete out.birthDate
  const pick = (v: unknown, from: Tag[]) =>
    [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string'))].filter((x) => from.some((t) => t.id === x))
  out.certificationIds = pick(r.certificationIds, lists.certifications)
  const dep = pick([r.departmentId], lists.departments)[0]
  if (dep) out.departmentId = dep
  return { details: out as Omit<Submission, 'id' | 'at'> }
}

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '').replace(/^972/, '0')

/** Keyed hashes of the answer's mobile and ID number: who already sent, without storing the numbers. */
export async function senderMarks(env: Env, d: { mobilePhone?: string; idNumber?: string }) {
  const parts = [digits(d.mobilePhone) && `m:${digits(d.mobilePhone)}`, digits(d.idNumber) && `i:${digits(d.idNumber)}`].filter(Boolean)
  return Promise.all(parts.map((p) => sha256url(`${env.sessionKey}|${p}`)))
}

const readForm = async (env: Env) => open<Form>(env.sessionKey, await kv.get(env, KEYS.joinForm))

async function readSubmissions(env: Env) {
  const sealed = await kv.members(env, KEYS.joinSubs)
  const opened = await Promise.all(sealed.map(async (s) => ({ sealed: s, sub: await open<Submission>(env.sessionKey, s) })))
  return opened.filter((o): o is { sealed: string; sub: Submission } => o.sub !== null)
}

export const GET = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (await overLimit(env, 'joinRead', clientIp(req))) return json({ reason: 'too-many' }, 429)
  const code = new URL(req.url).searchParams.get('c')
  const form = await readForm(env)
  if (!form || !code || code !== form.code) return json({ reason: 'closed' }, 404)
  return json({ lists: form.lists })
})

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  const body = await readJson(req, MAX_BODY)
  if (!body) return json({ reason: 'bad-body' }, 400)

  if (body.action === 'submit') {
    if (await overLimit(env, 'joinSubmit', clientIp(req))) return json({ reason: 'too-many' }, 429)
    const form = await readForm(env)
    if (!form || body.code !== form.code) return json({ reason: 'closed' }, 404)
    const cleaned = cleanDetails(body.details, form.lists)
    if ('reason' in cleaned) return json({ reason: cleaned.reason }, 400)
    const marks = await senderMarks(env, cleaned.details)
    for (const m of marks) if (await kv.isMember(env, KEYS.joinSent, m)) return json({ reason: 'already' }, 409)
    if ((await kv.members(env, KEYS.joinSubs)).length >= MAX_PENDING) return json({ reason: 'full' }, 429)
    const sub: Submission = { ...cleaned.details, id: randomToken(9), at: Date.now() }
    await kv.add(env, KEYS.joinSubs, await seal(env.sessionKey, sub))
    for (const m of marks) await kv.add(env, KEYS.joinSent, m)
    return json({ ok: true })
  }

  // Everything else is a manager's.
  if (await overLimit(env, 'joinManage', clientIp(req))) return json({ reason: 'too-many' }, 429)
  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate.refuse

  switch (body.action) {
    case 'open': {
      // Opening again keeps the same link (already sent to the group) and refreshes its choice lists.
      const current = await readForm(env)
      const code = current && body.renew !== true ? current.code : randomToken(12)
      await kv.set(env, KEYS.joinForm, await seal(env.sessionKey, { code, lists: cleanLists(body.lists) } satisfies Form))
      return json({ code })
    }
    case 'close':
      await kv.del(env, KEYS.joinForm)
      return json({ code: null })
    case 'list': {
      const form = await readForm(env)
      const subs = (await readSubmissions(env)).map((o) => o.sub).sort((a, b) => a.at - b.at)
      return json({ code: form?.code ?? null, submissions: subs })
    }
    case 'remove': {
      const found = (await readSubmissions(env)).find((o) => o.sub.id === body.id)
      if (found) {
        await kv.remove(env, KEYS.joinSubs, found.sealed)
        // Thrown away (not added to the list): this person may fill the form again.
        if (body.allowAgain === true) for (const m of await senderMarks(env, found.sub)) await kv.remove(env, KEYS.joinSent, m)
      }
      return json({ ok: true })
    }
    default:
      return json({ reason: 'bad-action' }, 400)
  }
})
