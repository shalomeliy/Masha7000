import { open, randomToken, seal, sha256url } from './crypto.js'
import type { Env } from './env.js'
import { revoke } from './google.js'
import { KEYS, kv } from './kv.js'

// Teams (smart onboarding part 2, docs/plans/smart-onboarding-part2-PLAN.md). A team = the Drive its
// data lives in. The root team is the owner's: OWNER_EMAIL plus the `allowed` list, on the owner's
// Drive, with the store keys it always had (nothing moved). Every other team is a customer the owner
// approved: his own Drive, his own managers (up to maxManagers, the owner included), his own forms
// and API keys, under `t:<id>:*`.
//
// The rules the security review set (2026-11-24):
// - One email belongs to one team only, and root wins. teamOf() null = refuse, never root.
// - The team is looked up here on every request, from the store. Never from a body, a query or the
//   session record. Team ids are random (tm_...), never an email.
// - Only this file names a team's store keys (teamKeys), and a customer's keys never are root's.

export const ROOT = 'root'
const ID = /^tm_[\w-]{8,40}$/
export const isCustomerId = (id: unknown): id is string => typeof id === 'string' && ID.test(id)

/** The plans the owner picks when approving (managers, the team owner included). */
export const MANAGER_LIMITS = [1, 10, 30] as const

export interface TeamRecord {
  id: string
  owner: string
  maxManagers: number
  businessName: string
  whatsapp: string
  createdAt: string
  /** The owner turned Claude on for this team (his budget): also the cloud voice and speech-to-text. */
  claude: boolean
}

export type Team =
  | { id: typeof ROOT; isRoot: true; isTeamOwner: boolean }
  | { id: string; isRoot: false; isTeamOwner: boolean; record: TeamRecord }

/** The store keys that only exist per customer team. */
const T = {
  record: (id: string) => `team:${id}`,
  ownerOf: (email: string) => `team-owner:${email}`,
  memberOf: (email: string) => `member:${email}`,
  members: (id: string) => `t:${id}:members`,
  all: 'teams',
}

/** The keys a team's data lives under. Root: exactly the keys it always had. */
export function teamKeys(id: string) {
  if (id === ROOT)
    return {
      refresh: KEYS.refresh,
      access: KEYS.access,
      joinForm: KEYS.joinForm,
      joinSubs: KEYS.joinSubs,
      joinSent: KEYS.joinSent,
      consForm: KEYS.consForm,
      consSubs: KEYS.consSubs,
      consAnswered: KEYS.consAnswered,
      consFirst: KEYS.consFirst,
      consDevice: KEYS.consDevice,
      consEdit: KEYS.consEdit,
      apiKeys: KEYS.apiKeys,
      apiLog: KEYS.apiLog,
    }
  if (!isCustomerId(id)) throw new Error('bad team id')
  const t = (name: string) => `t:${id}:${name}`
  return {
    refresh: t('refresh'),
    access: t('access'),
    joinForm: t('join:form'),
    joinSubs: t('join:subs'),
    joinSent: t('join:sent'),
    consForm: t('cons:form'),
    consSubs: t('cons:subs'),
    consAnswered: t('cons:answered'),
    consFirst: (week: string, workerId: string) => t(`cons:first:${week}:${workerId}`),
    consDevice: (week: string, workerId: string) => t(`cons:device:${week}:${workerId}`),
    consEdit: (token: string) => t(`cons:edit:${token}`),
    apiKeys: t('apikeys'),
    apiLog: t('api-log'),
  }
}

export async function readTeam(env: Env, id: string): Promise<TeamRecord | null> {
  if (!isCustomerId(id)) return null
  const rec = await open<TeamRecord>(env.sessionKey, await kv.get(env, T.record(id)))
  return rec && rec.id === id ? rec : null
}

const saveTeam = async (env: Env, rec: TeamRecord) => kv.set(env, T.record(rec.id), await seal(env.sessionKey, rec))

/** Which team this email works in, or null (refuse). Root is checked first and wins. */
export async function teamOf(env: Env, email: string): Promise<Team | null> {
  if (email === env.ownerEmail) return { id: ROOT, isRoot: true, isTeamOwner: true }
  if (await kv.isMember(env, KEYS.allowed, email)) return { id: ROOT, isRoot: true, isTeamOwner: false }
  const owned = await kv.get(env, T.ownerOf(email))
  if (owned) {
    const record = await readTeam(env, owned)
    if (record && record.owner === email) return { id: record.id, isRoot: false, isTeamOwner: true, record }
  }
  const joined = await kv.get(env, T.memberOf(email))
  if (joined) {
    const record = await readTeam(env, joined)
    if (record && (await kv.isMember(env, T.members(joined), email))) return { id: record.id, isRoot: false, isTeamOwner: false, record }
  }
  return null
}

/** Is this email anywhere already (root, a team owner, a team member)? One email, one team. */
export async function emailTaken(env: Env, email: string) {
  return (await teamOf(env, email)) !== null || (await kv.get(env, T.ownerOf(email))) !== null || (await kv.get(env, T.memberOf(email))) !== null
}

export async function listTeams(env: Env): Promise<(TeamRecord & { managers: string[] })[]> {
  const ids = await kv.members(env, T.all)
  const rows = await Promise.all(ids.map(async (id) => {
    const rec = await readTeam(env, id)
    return rec ? { ...rec, managers: (await kv.members(env, T.members(id))).sort() } : null
  }))
  return rows.filter((r): r is TeamRecord & { managers: string[] } => r !== null).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export const teamManagers = async (env: Env, id: string) => (await kv.members(env, T.members(id))).sort()

/** The owner approved a customer: a new team, its owner = that email. Null when the email is taken. */
export async function createTeam(env: Env, input: { owner: string; maxManagers: number; businessName: string; whatsapp: string }): Promise<TeamRecord | null> {
  if (input.owner === env.ownerEmail || (await emailTaken(env, input.owner))) return null
  const rec: TeamRecord = { id: `tm_${randomToken(12)}`, ...input, createdAt: new Date().toISOString(), claude: false }
  await saveTeam(env, rec)
  await kv.set(env, T.ownerOf(input.owner), rec.id)
  await kv.add(env, T.all, rec.id)
  return rec
}

export async function updateTeam(env: Env, id: string, change: Partial<Pick<TeamRecord, 'claude' | 'maxManagers'>>): Promise<TeamRecord | null> {
  const rec = await readTeam(env, id)
  if (!rec) return null
  const next = { ...rec, ...change }
  await saveTeam(env, next)
  return next
}

export type AddResult = 'ok' | 'taken' | 'full'

/** A customer team owner adds a manager to his team: never an email that is anywhere already. */
export async function addMember(env: Env, rec: TeamRecord, email: string): Promise<AddResult> {
  if (email === env.ownerEmail || email === rec.owner || (await emailTaken(env, email))) {
    return (await kv.isMember(env, T.members(rec.id), email)) ? 'ok' : 'taken'
  }
  const members = await kv.members(env, T.members(rec.id))
  if (members.length + 1 >= rec.maxManagers) return 'full'
  await kv.set(env, T.memberOf(email), rec.id)
  await kv.add(env, T.members(rec.id), email)
  return 'ok'
}

/** Signed out on every device and two-step forgotten (a fresh setup if ever added again). */
async function forget(env: Env, email: string) {
  const sids = await kv.members(env, KEYS.sessionsOf(email))
  if (sids.length) await kv.del(env, ...sids.map(KEYS.session))
  await kv.del(env, KEYS.sessionsOf(email), KEYS.mfa(email), KEYS.mfaSetup(email))
}

/** Out of the team, signed out everywhere now. False when the email is not this team's manager. */
export async function removeMember(env: Env, id: string, email: string): Promise<boolean> {
  if (!(await kv.isMember(env, T.members(id), email))) return false
  await kv.remove(env, T.members(id), email)
  if ((await kv.get(env, T.memberOf(email))) === id) await kv.del(env, T.memberOf(email))
  await forget(env, email)
  return true
}

/** Revokes the app's access to the team's Drive and forgets its tokens (the data stays in his Drive). */
export async function disconnectTeamDrive(env: Env, id: string) {
  const keys = teamKeys(id)
  if (id === ROOT) throw new Error('root drive is not a team drive')
  const refresh = await open<string>(env.sessionKey, await kv.get(env, keys.refresh))
  if (refresh) await revoke(refresh)
  await kv.del(env, keys.refresh, keys.access)
}

// A public form link (/join/<code>, /constraints/<code>) -> its team: fcode:<kind>:<sha256 of the code>
// holds the sealed team id. Customer teams only; a code with no record is root's, checked against
// root's form as always. The team comes only from this record, never from the request.
const formCodeKey = async (kind: 'join' | 'cons', code: string) => `fcode:${kind}:${await sha256url(code)}`

export async function linkFormCode(env: Env, kind: 'join' | 'cons', code: string, teamId: string) {
  if (teamId === ROOT) return
  await kv.set(env, await formCodeKey(kind, code), await seal(env.sessionKey, { teamId }))
}

export async function unlinkFormCode(env: Env, kind: 'join' | 'cons', code: string | undefined) {
  if (code) await kv.del(env, await formCodeKey(kind, code))
}

/** The team whose form this public code is: a customer's id when one linked it, otherwise root. */
export async function teamOfFormCode(env: Env, kind: 'join' | 'cons', code: unknown): Promise<string> {
  if (typeof code !== 'string' || !code || code.length > 64) return ROOT
  const rec = await open<{ teamId: string }>(env.sessionKey, await kv.get(env, await formCodeKey(kind, code)))
  return rec && isCustomerId(rec.teamId) && (await readTeam(env, rec.teamId)) ? rec.teamId : ROOT
}

/**
 * The whole team goes: Drive access revoked, every manager and the owner signed out, its forms, API
 * keys and store keys gone. The data itself stays in the customer's Drive. `revokeKeys` is apiKeys.ts's
 * (passed in, so this file has no loop of imports).
 */
export async function removeTeam(env: Env, id: string, revokeKeys: (env: Env, teamId: string) => Promise<void>) {
  const rec = await readTeam(env, id)
  if (!rec) return false
  await disconnectTeamDrive(env, id)
  for (const email of await kv.members(env, T.members(id))) await removeMember(env, id, email)
  await forget(env, rec.owner)
  await revokeKeys(env, id)
  const keys = teamKeys(id)
  for (const [kind, key] of [['join', keys.joinForm], ['cons', keys.consForm]] as const)
    await unlinkFormCode(env, kind, (await open<{ code: string }>(env.sessionKey, await kv.get(env, key)))?.code)
  await kv.del(env, keys.joinForm, keys.joinSubs, keys.joinSent, keys.consForm, keys.consSubs, keys.consAnswered, keys.apiKeys, keys.apiLog, T.members(id), T.record(id))
  if ((await kv.get(env, T.ownerOf(rec.owner))) === id) await kv.del(env, T.ownerOf(rec.owner))
  await kv.remove(env, T.all, id)
  return true
}
