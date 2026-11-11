import { open, seal } from './_lib/crypto.js'
import { readEnv } from './_lib/env.js'
import { refreshAccess } from './_lib/google.js'
import { guarded, json } from './_lib/http.js'
import { KEYS, kv } from './_lib/kv.js'
import { isOwner, requireManager } from './_lib/session.js'

// SPIKE (throwaway, docs/specs/json-external-api.md): how fast can the server read the owner's
// Drive files for an outside API? Owner only, signed in (open the URL in the app's browser).
// Answers ONLY timings and counts, never the data itself. Delete after the verdict.
// GET /api/spike-drive

const FILES = 'https://www.googleapis.com/drive/v3/files'
const MONTH = /^shifts-(\d{4}-\d{2})\.json$/

interface Cached {
  token: string
  exp: number
}

const ms = (t: number) => Math.round(performance.now() - t)

async function accessToken(env: NonNullable<ReturnType<typeof readEnv>>): Promise<{ token: string | null; cached: boolean }> {
  const cached = await open<Cached>(env.sessionKey, await kv.get(env, KEYS.access))
  if (cached && cached.exp - Date.now() > 120_000) return { token: cached.token, cached: true }
  const refresh = await open<string>(env.sessionKey, await kv.get(env, KEYS.refresh))
  if (!refresh) return { token: null, cached: false }
  const { ok, data } = await refreshAccess(env, refresh)
  if (!ok || !data.access_token) return { token: null, cached: false }
  const expiresIn = data.expires_in ?? 3600
  await kv.set(env, KEYS.access, await seal(env.sessionKey, { token: data.access_token, exp: Date.now() + expiresIn * 1000 } satisfies Cached), expiresIn - 60)
  return { token: data.access_token, cached: false }
}

export const GET = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate.refuse
  if (!isOwner(env, gate.session.email)) return json({ reason: 'not-owner' }, 403)

  const all = performance.now()
  let t = performance.now()
  const { token, cached } = await accessToken(env)
  const tokenMs = ms(t)
  if (!token) return json({ reason: 'owner-disconnected' }, 409)
  const get = (url: string) => fetch(url, { headers: { Authorization: `Bearer ${token}` } })

  t = performance.now()
  const q = encodeURIComponent("name contains 'shifts-' and trashed = false")
  const list = (await (await get(`${FILES}?spaces=appDataFolder&q=${q}&pageSize=1000&fields=files(id,name,size)`)).json()) as {
    files?: { id: string; name: string; size?: string }[]
  }
  const listMs = ms(t)
  const months = (list.files ?? []).filter((f) => MONTH.test(f.name)).sort((a, b) => b.name.localeCompare(a.name))

  const read = async (files: typeof months) => {
    const s = performance.now()
    const bodies = await Promise.all(files.map(async (f) => (await (await get(`${FILES}/${f.id}?alt=media`)).json()) as unknown[]))
    return { months: files.length, shifts: bodies.reduce((n, b) => n + (Array.isArray(b) ? b.length : 0), 0), ms: ms(s) }
  }
  const oneMonth = await read(months.slice(0, 1))
  const year = await read(months.slice(0, 12))
  const yearAgain = await read(months.slice(0, 12))

  return json({
    token: { ms: tokenMs, cached },
    listMonthFiles: { ms: listMs, found: months.length, bytes: months.reduce((n, f) => n + Number(f.size ?? 0), 0) },
    oneMonth,
    year,
    yearAgain,
    totalMs: ms(all),
    region: process.env.VERCEL_REGION ?? 'local',
  })
})
