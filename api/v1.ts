import { keyOf, logCall, markUsed, type ApiKey } from './_lib/apiKeys.js'
import { Drive, DriveConflict, DriveFailed, ownerToken } from './_lib/drive.js'
import { readEnv, type Env } from './_lib/env.js'
import { clientIp } from './_lib/http.js'
import { overLimit } from './_lib/rate.js'
import { SCHEMA, SCHEMA_VERSION, toApiConstraint, toApiNamed, toApiPendingJob, toApiShift, toApiWorker } from './_lib/v1/contract.js'
import { GENERAL_CERT_ID, normalizeConstraint, normalizePendingJob, normalizeShiftRecord, normalizeWorker, withGeneralCert, type StoredShift } from './_lib/v1/normalize.js'
import * as store from './_lib/v1/store.js'
import { date, idList, Invalid, isDate, oneOf, onlyFields, staffing, stars, text } from './_lib/v1/validate.js'

// The outside API: /api/v1/<path>, reached through the rewrite in vercel.json (/api/v1/x -> /api/v1?path=x).
// Called by other systems with `Authorization: Bearer <key>` (Settings > "גישת API"). No cookies, no
// CORS headers. Reads and writes the owner's Drive files directly; the open app sees a write as
// someone else's save (it reloads before its own next save). Every answer is
// { schemaVersion, data, warnings? } or { schemaVersion, error: { code, message, field? } }. docs/api.md.

type Raw = Record<string, unknown>
const MAX_BODY = 32_000
const MAX_RANGE_DAYS = 366

class Fail extends Error {
  status: number
  code: string
  field?: string
  constructor(status: number, code: string, message = code, field?: string) {
    super(message)
    this.status = status
    this.code = code
    this.field = field
  }
}

function answer(status: number, body: Raw) {
  return new Response(JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...body }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
const ok = (data: unknown, warnings: string[] = [], status = 200) => answer(status, { data, ...(warnings.length ? { warnings } : {}) })

function pathOf(req: Request): string[] {
  const url = new URL(req.url)
  const raw = url.searchParams.get('path') ?? url.pathname.replace(/^\/api\/v1\/?/, '')
  return raw.split('/').filter(Boolean)
}

async function body(req: Request): Promise<Raw> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) throw new Fail(413, 'too-big')
  const raw = await req.text().catch(() => '')
  if (raw.length > MAX_BODY) throw new Fail(413, 'too-big')
  try {
    const v: unknown = JSON.parse(raw || '{}')
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Raw
  } catch {
    // falls through
  }
  throw new Fail(400, 'bad-json', 'the body must be one JSON object')
}

const days = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000

/** The crew changes between the saved crew and the new one, as the app records them (src/lib/archive.ts crewSwaps). */
function crewSwaps(before: { workerId: string }[], after: { workerId: string }[], at: string) {
  const out: { at: string; outId: string; inId: string }[] = []
  before.forEach((b, i) => {
    const a = after[i]
    if (a && a.workerId !== b.workerId && !before.some((x) => x.workerId === a.workerId) && !after.some((x) => x.workerId === b.workerId)) out.push({ at, outId: b.workerId, inId: a.workerId })
  })
  return out
}

// ---- reads ----

async function read(drive: Drive, key: ApiKey, path: string[], url: URL): Promise<Response> {
  const [what, id, more] = path
  if (more) throw new Fail(404, 'not-found')
  switch (what) {
    case 'schema':
      if (id) break
      return ok(SCHEMA)
    case 'workers': {
      const all = await store.workers(drive)
      if (id) {
        const w = all.find((x) => x.id === id)
        if (!w) throw new Fail(404, 'not-found', 'no such worker')
        return ok(toApiWorker(w, key.personal))
      }
      const withInactive = url.searchParams.get('includeInactive') === 'true'
      return ok(all.filter((w) => withInactive || w.status !== 'inactive').map((w) => toApiWorker(w, key.personal)))
    }
    case 'shifts': {
      if (id) {
        const found = await store.findShift(drive, id)
        if (!found) throw new Fail(404, 'not-found', 'no such shift')
        return ok(toApiShift(normalizeShiftRecord(found.raw)))
      }
      const from = url.searchParams.get('from') ?? ''
      const to = url.searchParams.get('to') ?? ''
      if (!isDate(from)) throw new Fail(422, 'invalid', 'from: required, YYYY-MM-DD', 'from')
      if (!isDate(to) || to < from) throw new Fail(422, 'invalid', 'to: required, YYYY-MM-DD, not before from', 'to')
      if (days(from, to) > MAX_RANGE_DAYS) throw new Fail(422, 'invalid', `at most ${MAX_RANGE_DAYS} days at a time`, 'to')
      return ok((await store.shiftsBetween(drive, from, to)).map(toApiShift))
    }
    case 'pending-jobs': {
      if (id) break
      const waiting = url.searchParams.get('waiting') === 'true'
      return ok((await store.pendingJobs(drive)).filter((j) => !waiting || !j.scheduledShiftId).map(toApiPendingJob))
    }
    case 'certifications':
      if (id) break
      return ok(withGeneralCert(await store.named(drive, store.FILES.certifications)).map(toApiNamed))
    case 'shift-kinds':
      if (id) break
      return ok((await store.named(drive, store.FILES.shiftKinds)).map(toApiNamed))
    case 'departments':
      if (id) break
      return ok((await store.named(drive, store.FILES.departments)).map(toApiNamed))
    case 'work-kinds':
      if (id) break
      return ok((await store.named(drive, store.FILES.workKinds)).map(toApiNamed))
  }
  throw new Fail(404, 'not-found')
}

// ---- writes ----

interface Known {
  workers: Map<string, ReturnType<typeof normalizeWorker>>
  certs: Set<string>
  kinds: Set<string>
}

async function known(drive: Drive): Promise<Known> {
  const [workers, certs, kinds] = await Promise.all([store.workers(drive), store.named(drive, store.FILES.certifications), store.named(drive, store.FILES.shiftKinds)])
  return {
    workers: new Map(workers.map((w) => [w.id, w])),
    certs: new Set([GENERAL_CERT_ID, ...certs.map((c) => c.id)]),
    kinds: new Set(kinds.map((k) => k.id)),
  }
}

/** Warnings the app also gives: a crew member already in another job that day, or without a place's certifications. */
function crewWarnings(k: Known, shift: StoredShift, sameDay: StoredShift[]): string[] {
  const out: string[] = []
  for (const { workerId } of shift.crew) {
    const w = k.workers.get(workerId)!
    const busy = sameDay.find((s) => s.id !== shift.id && s.crew.some((c) => c.workerId === workerId))
    if (busy) out.push(`worker ${workerId} is also in shift ${busy.id} on ${shift.date}`)
    if (w.status === 'sick' && (!w.sickUntil || w.sickUntil >= shift.date)) out.push(`worker ${workerId} is marked sick`)
  }
  shift.staffing.forEach((slot, i) => {
    const holder = shift.crew[i] && k.workers.get(shift.crew[i].workerId)
    const missing = (slot.certificationIds ?? []).filter((c) => holder && !holder.certificationIds.includes(c))
    if (missing.length) out.push(`worker ${shift.crew[i].workerId} in place ${i} lacks ${missing.join(', ')}`)
  })
  return out
}

function crewOf(b: Raw, k: Known, field = 'crew') {
  const ids = idList(b, field, new Set(k.workers.keys()))
  if (!ids) return undefined
  const inactive = ids.find((id) => k.workers.get(id)!.status === 'inactive')
  if (inactive) throw new Invalid(field, `worker ${inactive} is inactive`)
  return ids
}

async function sameDayShifts(drive: Drive, day: string) {
  return store.shiftsBetween(drive, day, day)
}

const SHIFT_FIELDS = ['date', 'shiftKindId', 'location', 'jobDescription', 'crew', 'pinnedWorkerIds', 'staffing']

async function createShift(drive: Drive, b: Raw) {
  onlyFields(b, SHIFT_FIELDS)
  const k = await known(drive)
  const day = date(b, 'date', true)!
  const location = text(b, 'location') ?? ''
  const jobDescription = text(b, 'jobDescription') ?? ''
  if (!location && !jobDescription) throw new Invalid('location', 'a location or a jobDescription is needed')
  const crew = crewOf(b, k) ?? []
  const pinned = crewOf(b, k, 'pinnedWorkerIds') ?? []
  const notInCrew = pinned.find((id) => !crew.includes(id))
  if (notInCrew) throw new Invalid('pinnedWorkerIds', `worker ${notInCrew} is not in the crew`)
  const slots = staffing(b, 'staffing', k.certs) ?? crew.map(() => ({}))
  const kind = oneOf(b, 'shiftKindId', k.kinds)
  const shift: Raw = {
    id: crypto.randomUUID(),
    date: day,
    ...(kind ? { shiftDefinitionId: kind } : {}),
    location,
    jobDescription,
    crew: crew.map((workerId) => ({ workerId })),
    staffing: slots,
    ...(pinned.length ? { pinnedIds: pinned } : {}),
  }
  const stored = normalizeShiftRecord(shift)
  const warnings = crewWarnings(k, stored, await sameDayShifts(drive, day))
  await store.putShift(drive, shift)
  return ok(toApiShift(stored), warnings, 201)
}

async function patchShift(drive: Drive, id: string, b: Raw) {
  onlyFields(b, SHIFT_FIELDS)
  const found = await store.findShift(drive, id)
  if (!found) throw new Fail(404, 'not-found', 'no such shift')
  const k = await known(drive)
  const old = normalizeShiftRecord(found.raw)
  const next: Raw = { ...found.raw }
  const day = date(b, 'date')
  if (day) next.date = day
  if ('shiftKindId' in b) {
    const kind = oneOf(b, 'shiftKindId', k.kinds)
    if (kind) next.shiftDefinitionId = kind
    else delete next.shiftDefinitionId
  }
  const location = text(b, 'location')
  if (location !== undefined) next.location = location
  const jobDescription = text(b, 'jobDescription')
  if (jobDescription !== undefined) next.jobDescription = jobDescription
  const crew = crewOf(b, k)
  if (crew) {
    const after = crew.map((workerId) => ({ workerId }))
    const swaps = crewSwaps(old.crew, after, new Date().toISOString())
    next.crew = after
    if (swaps.length) next.swaps = [...((found.raw.swaps as unknown[]) ?? []), ...swaps]
  }
  const slots = staffing(b, 'staffing', k.certs)
  if (slots) next.staffing = slots
  const pinned = crewOf(b, k, 'pinnedWorkerIds')
  if (pinned) next.pinnedIds = pinned
  const stored = normalizeShiftRecord(next)
  const notInCrew = (stored.pinnedIds ?? []).find((p) => !stored.crew.some((c) => c.workerId === p))
  if (notInCrew) throw new Invalid('pinnedWorkerIds', `worker ${notInCrew} is not in the crew`)
  const warnings = crewWarnings(k, stored, await sameDayShifts(drive, stored.date))
  if (store.monthFile(stored.date) === found.read.name) await store.putShift(drive, next, found.read)
  else {
    // Moved to another month: into the new month first, then out of the old one (a cut shows it twice at worst).
    await store.putShift(drive, next)
    await store.dropShift(drive, found.read, id)
  }
  return ok(toApiShift(stored), warnings)
}

async function createPendingJob(drive: Drive, b: Raw) {
  onlyFields(b, ['location', 'jobDescription', 'shiftKindId', 'staffing', 'pinnedWorkerIds', 'note'])
  const k = await known(drive)
  const location = text(b, 'location') ?? ''
  const jobDescription = text(b, 'jobDescription') ?? ''
  if (!location && !jobDescription) throw new Invalid('location', 'a location or a jobDescription is needed')
  const kind = oneOf(b, 'shiftKindId', k.kinds)
  const pinned = crewOf(b, k, 'pinnedWorkerIds') ?? []
  const note = text(b, 'note')
  const job: Raw = {
    id: crypto.randomUUID(),
    location,
    jobDescription,
    staffing: staffing(b, 'staffing', k.certs) ?? [],
    ...(kind ? { shiftDefinitionId: kind } : {}),
    reasonIds: [],
    createdAt: new Date().toISOString(),
    ...(note ? { note } : {}),
    ...(pinned.length ? { pinnedIds: pinned } : {}),
  }
  const { read: before, list } = await store.readList(drive, store.FILES.pendingJobs)
  await drive.write(before, [...list, job])
  return ok(toApiPendingJob(normalizePendingJob(job)), [], 201)
}

async function patchWorker(drive: Drive, id: string, b: Raw, key: ApiKey) {
  onlyFields(b, ['status', 'sickUntil', 'departmentId', 'certifications'])
  const { read: before, list } = await store.readList(drive, store.FILES.workers)
  const at = list.findIndex((w) => w.id === id)
  if (at < 0) throw new Fail(404, 'not-found', 'no such worker')
  const raw: Raw = { ...list[at] }
  if ('status' in b) {
    if (!['active', 'sick', 'inactive'].includes(String(b.status))) throw new Invalid('status', 'active, sick or inactive')
    raw.status = b.status
    if (b.status === 'sick') raw.sickUntil = date(b, 'sickUntil', true)
    else delete raw.sickUntil
  } else if ('sickUntil' in b) throw new Invalid('sickUntil', 'only with status: sick')
  if ('departmentId' in b) {
    const dep = oneOf(b, 'departmentId', new Set((await store.named(drive, store.FILES.departments)).map((d) => d.id)))
    if (dep) raw.departmentId = dep
    else delete raw.departmentId
  }
  if ('certifications' in b) {
    const certs = new Set([GENERAL_CERT_ID, ...(await store.named(drive, store.FILES.certifications)).map((c) => c.id)])
    if (!Array.isArray(b.certifications) || b.certifications.length > 50) throw new Invalid('certifications', 'must be a list')
    const old = normalizeWorker(list[at])
    const ids: string[] = []
    const ratings: Record<string, number> = {}
    const expiry: Record<string, string> = {}
    b.certifications.forEach((c: unknown, i: number) => {
      const f = `certifications[${i}]`
      if (!c || typeof c !== 'object') throw new Invalid(f, 'must be an object')
      const item = c as Raw
      onlyFields(item, ['id', 'stars', 'validUntil'])
      const cid = oneOf(item, 'id', certs)
      if (!cid) throw new Invalid(`${f}.id`, 'required')
      if (ids.includes(cid)) throw new Invalid(`${f}.id`, 'the same id twice')
      ids.push(cid)
      // A certification the worker did not hold starts with no stars, as in the app.
      const had = old.certificationIds.includes(cid)
      const s = item.stars === undefined ? (had ? old.certRatings?.[cid] : 0) : stars(item.stars, `${f}.stars`)
      if (s !== undefined) ratings[cid] = s
      const until = item.validUntil === undefined ? (had ? old.certExpiry?.[cid] : undefined) : date(item, 'validUntil')
      if (until && cid !== GENERAL_CERT_ID) expiry[cid] = until
    })
    if (!ids.includes(GENERAL_CERT_ID)) ids.unshift(GENERAL_CERT_ID)
    raw.certificationIds = ids
    raw.certRatings = ratings
    raw.certExpiry = expiry
    if (!Object.keys(expiry).length) delete raw.certExpiry
  }
  await drive.write(before, list.map((w, i) => (i === at ? raw : w)))
  return ok(toApiWorker(normalizeWorker(raw), key.personal))
}

async function addConstraint(drive: Drive, id: string, b: Raw, key: ApiKey) {
  onlyFields(b, ['when', 'kind', 'from', 'to', 'weekdays', 'nightsOnly', 'part', 'note'])
  const { read: before, list } = await store.readList(drive, store.FILES.workers)
  const at = list.findIndex((w) => w.id === id)
  if (at < 0) throw new Fail(404, 'not-found', 'no such worker')
  const when = b.when ?? 'dates'
  if (!['dates', 'weekdays', 'always'].includes(String(when))) throw new Invalid('when', 'dates, weekdays or always')
  const c: Raw = { id: crypto.randomUUID(), when }
  if (b.kind !== undefined && b.kind !== null) {
    if (!['vacation', 'study', 'reserve', 'course', 'sick'].includes(String(b.kind))) throw new Invalid('kind', 'vacation, study, reserve, course or sick')
    c.kind = b.kind
  }
  if (when === 'dates') {
    c.from = date(b, 'from', true)
    c.to = date(b, 'to') ?? c.from
    if (String(c.to) < String(c.from)) throw new Invalid('to', 'not before from')
  }
  if (when === 'weekdays') {
    const wd = b.weekdays
    if (!Array.isArray(wd) || !wd.length || wd.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || new Set(wd).size !== wd.length) throw new Invalid('weekdays', 'a list of days 0-6 (0 = Sunday), at least one')
    c.weekdays = wd
    const from = date(b, 'from')
    const to = date(b, 'to')
    if (from) c.from = from
    if (to) c.to = to
  } else if (b.weekdays !== undefined) throw new Invalid('weekdays', 'only with when: weekdays')
  if (b.nightsOnly === true) c.nightsOnly = true
  if (b.part !== undefined && b.part !== null) {
    if (!['morning', 'noon', 'evening'].includes(String(b.part))) throw new Invalid('part', 'morning, noon or evening')
    if (c.nightsOnly || when === 'always') throw new Invalid('part', 'not with nightsOnly')
    c.part = b.part
  }
  const note = text(b, 'note')
  if (note) c.note = note
  const raw: Raw = { ...list[at], constraints: [...((list[at].constraints as unknown[]) ?? []), c] }
  await drive.write(before, list.map((w, i) => (i === at ? raw : w)))
  return ok(toApiConstraint(normalizeConstraint(c), key.personal), [], 201)
}

async function write(drive: Drive, key: ApiKey, method: string, path: string[], req: Request): Promise<Response> {
  const b = await body(req)
  const [what, id, sub, more] = path
  if (more) throw new Fail(404, 'not-found')
  if (method === 'POST' && what === 'shifts' && !id) {
    if (await store.legacyShiftsLeft(drive)) throw new Fail(409, 'open-app-first', 'open the app once so it updates its shift files, then try again')
    return createShift(drive, b)
  }
  if (method === 'PATCH' && what === 'shifts' && id && !sub) {
    if (await store.legacyShiftsLeft(drive)) throw new Fail(409, 'open-app-first', 'open the app once so it updates its shift files, then try again')
    return patchShift(drive, id, b)
  }
  if (method === 'POST' && what === 'pending-jobs' && !id) return createPendingJob(drive, b)
  if (method === 'PATCH' && what === 'workers' && id && !sub) return patchWorker(drive, id, b, key)
  if (method === 'POST' && what === 'workers' && id && sub === 'constraints') return addConstraint(drive, id, b, key)
  throw new Fail(404, 'not-found')
}

// ---- the gate ----

async function handle(req: Request, env: Env, key: ApiKey): Promise<Response> {
  const method = req.method.toUpperCase()
  const isWrite = method === 'POST' || method === 'PATCH'
  if (!isWrite && method !== 'GET') throw new Fail(405, 'bad-method', 'GET, POST or PATCH')
  if (isWrite && !key.scopes.includes('write')) throw new Fail(403, 'no-scope', 'this key may only read')
  if (await overLimit(env, 'apiKey', key.id)) throw new Fail(429, 'too-many', 'at most 60 calls a minute per key')
  const got = await ownerToken(env)
  if ('reason' in got) throw new Fail(got.reason === 'owner-disconnected' ? 409 : 502, got.reason)
  const drive = new Drive(got.token)
  const path = pathOf(req)
  return isWrite ? write(drive, key, method, path, req) : read(drive, key, path, new URL(req.url))
}

async function entry(req: Request): Promise<Response> {
  const env = readEnv()
  if (!env) return answer(503, { error: { code: 'not-configured', message: 'not-configured' } })
  const key = await keyOf(env, req)
  let res: Response
  if (!key) {
    if (await overLimit(env, 'apiBadKey', clientIp(req))) res = answer(429, { error: { code: 'too-many', message: 'too many wrong keys' } })
    else res = answer(401, { error: { code: 'bad-key', message: 'send Authorization: Bearer <key> with a key from Settings > API access' } })
  } else {
    try {
      res = await handle(req, env, key)
    } catch (e) {
      if (e instanceof Fail) res = answer(e.status, { error: { code: e.code, message: e.message, ...(e.field ? { field: e.field } : {}) } })
      else if (e instanceof Invalid) res = answer(422, { error: { code: 'invalid', message: `${e.field}: ${e.message}`, field: e.field } })
      else if (e instanceof DriveConflict) res = answer(409, { error: { code: 'conflict', message: 'the data changed while this call ran; nothing was written, try again' } })
      else if (e instanceof DriveFailed) res = answer(502, { error: { code: 'google-failed', message: 'Google Drive did not answer; try again' } })
      else {
        console.error('api v1 error', (e as Error).name)
        res = answer(500, { error: { code: 'server-error', message: 'server-error' } })
      }
    }
    await markUsed(env, key.id).catch(() => {})
  }
  await logCall(env, { at: new Date().toISOString(), keyId: key?.id ?? null, method: req.method, path: `/${pathOf(req).join('/')}`.slice(0, 200), status: res.status }).catch(() => {})
  return res
}

export const GET = entry
export const POST = entry
export const PATCH = entry
