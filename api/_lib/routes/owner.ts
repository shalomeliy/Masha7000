import { apiKeysAction } from '../apiKeysRoute.js'
import { audit, readAudit } from '../audit.js'
import { open } from '../crypto.js'
import { readEnv, type Env } from '../env.js'
import { revoke } from '../google.js'
import { clientIp, guarded, json, readJson, sameOrigin } from '../http.js'
import { KEYS, kv } from '../kv.js'
import { overLimit } from '../rate.js'
import { endAllSessions, isOwner, normalizeEmail, requireManager } from '../session.js'
import { approveRequest, listRequests, rejectRequest } from '../accessRequests.js'
import { revokeTeamKeys } from '../apiKeys.js'
import { addMember, disconnectTeamDrive, emailTaken, listTeams, MANAGER_LIMITS, readTeam, removeMember, removeTeam, teamManagers, updateTeam, type Team } from '../team.js'

// POST /api/owner { action }: a team owner's controls.
//
// The root owner (OWNER_EMAIL): 'list' | 'add' | 'remove' manage who may sign in to his team;
// 'assistant' { email, on } opens or closes the voice assistant to one of them (free commands only);
// 'assistant-claude' { email, on } lets that manager's Shali ask Claude too (the owner's budget)
// (the owner is implicit and never stored); 'disconnect' revokes the app's access to the owner's Drive;
// 'audit' reads the security log (api/_lib/audit.ts). Customers (smart onboarding part 2):
// 'requests' the access requests waiting, 'approve' { email, maxManagers } / 'reject' { email },
// 'teams' the approved customers, 'team-claude' { id, on }, 'team-limit' { id, maxManagers },
// 'team-remove' { id }.
//
// A customer team's owner (api/_lib/team.ts), his own code path, his own team only:
// 'list' | 'add' | 'remove' his managers (up to his plan), 'disconnect' his own Drive.
//
// POST /api/owner?scope=api-keys { action }: the outside-API keys of the caller's team (api/_lib/apiKeysRoute.ts).
// Every change here is written to the security log. The team always comes from the session.

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  const keys = new URL(req.url).searchParams.get('scope') === 'api-keys'
  if (await overLimit(env, keys ? 'apiKeysManage' : 'owner', clientIp(req))) return json({ reason: 'too-many' }, 429)
  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate.refuse
  const { team } = gate
  if (!team.isTeamOwner) return json({ reason: 'not-owner' }, 403)

  const body = await readJson(req)
  if (!body) return json({ reason: keys ? 'bad-request' : 'bad-body' }, 400)
  const me = gate.session.email
  if (keys) {
    const answer = await apiKeysAction(env, team.id, body)
    if (answer.ok && (body.action === 'create' || body.action === 'revoke'))
      await audit(env, req, body.action === 'create' ? 'apikey-create' : 'apikey-revoke', { email: me, target: String(body.name ?? body.id ?? '').slice(0, 80) })
    return answer
  }
  if (!team.isRoot) return customerOwner(env, req, team, me, body)
  if (!isOwner(env, me)) return json({ reason: 'not-owner' }, 403)
  const customers = await customerActions(env, req, me, body)
  if (customers) return customers

  if (body.action === 'audit') return json({ entries: await readAudit(env) })
  if (body.action === 'disconnect') {
    const refresh = await open<string>(env.sessionKey, await kv.get(env, KEYS.refresh))
    if (refresh) await revoke(refresh)
    await kv.del(env, KEYS.refresh, KEYS.access)
    await audit(env, req, 'drive-disconnect', { email: me })
    return json({ ok: true })
  }
  if (body.action === 'assistant') {
    const email = normalizeEmail(body.email)
    if (!email || !(await kv.isMember(env, KEYS.allowed, email))) return json({ reason: 'bad-email' }, 400)
    if (body.on === true) await kv.add(env, KEYS.assistant, email)
    else await kv.remove(env, KEYS.assistant, email)
    if (body.on !== true) await kv.remove(env, KEYS.assistantClaude, email)
    await audit(env, req, 'assistant-access', { email: me, target: `${email} ${body.on === true ? 'on' : 'off'}` })
  } else if (body.action === 'assistant-claude') {
    const email = normalizeEmail(body.email)
    if (!email || !(await kv.isMember(env, KEYS.allowed, email))) return json({ reason: 'bad-email' }, 400)
    if (body.on === true) {
      await kv.add(env, KEYS.assistant, email)
      await kv.add(env, KEYS.assistantClaude, email)
    } else await kv.remove(env, KEYS.assistantClaude, email)
    await audit(env, req, 'assistant-access', { email: me, target: `${email} claude ${body.on === true ? 'on' : 'off'}` })
  } else if (body.action === 'add' || body.action === 'remove') {
    const email = normalizeEmail(body.email)
    if (!email) return json({ reason: 'bad-email' }, 400)
    if (email === env.ownerEmail) return json({ reason: 'owner-implicit' }, 400)
    if (body.action === 'add') {
      // One email, one team: a customer's owner or manager is not added to the owner's team too.
      if (!(await kv.isMember(env, KEYS.allowed, email)) && (await emailTaken(env, email))) return json({ reason: 'other-team' }, 409)
      await audit(env, req, 'access-add', { email: me, target: email })
      await kv.add(env, KEYS.allowed, email)
    } else {
      await audit(env, req, 'access-remove', { email: me, target: email })
      // Out of the list: signed out everywhere now, and a fresh two-step setup if ever added back.
      await kv.remove(env, KEYS.allowed, email)
      await kv.remove(env, KEYS.assistant, email)
      await kv.remove(env, KEYS.assistantClaude, email)
      await endAllSessions(env, email)
      await kv.del(env, KEYS.mfa(email), KEYS.mfaSetup(email))
    }
  } else if (body.action !== 'list') {
    return json({ reason: 'bad-action' }, 400)
  }
  const emails = (await kv.members(env, KEYS.allowed)).sort()
  const assistant = (await kv.members(env, KEYS.assistant)).filter((e) => emails.includes(e)).sort()
  const claude = (await kv.members(env, KEYS.assistantClaude)).filter((e) => assistant.includes(e)).sort()
  return json({ owner: env.ownerEmail, emails, assistant, claude })
})

const limitOf = (v: unknown) => (MANAGER_LIMITS as readonly number[]).includes(v as number) ? (v as number) : null

/** The root owner's customer actions; null when the action is not one of them. */
async function customerActions(env: Env, req: Request, me: string, body: Record<string, unknown>): Promise<Response | null> {
  const teamsAnswer = async () => json({ requests: await listRequests(env), teams: await listTeams(env) })
  switch (body.action) {
    case 'requests':
    case 'teams':
      return teamsAnswer()
    case 'approve': {
      const email = normalizeEmail(body.email)
      const max = limitOf(body.maxManagers)
      if (!email || !max) return json({ reason: 'bad-request' }, 400)
      const rec = await approveRequest(env, email, max)
      if (!rec) return json({ reason: 'other-team' }, 409)
      await audit(env, req, 'team-approve', { email: me, target: `${email} ${max}` })
      return teamsAnswer()
    }
    case 'reject': {
      const email = normalizeEmail(body.email)
      if (!email) return json({ reason: 'bad-email' }, 400)
      await rejectRequest(env, email)
      await audit(env, req, 'team-reject', { email: me, target: email })
      return teamsAnswer()
    }
    case 'team-claude':
    case 'team-limit': {
      if (typeof body.id !== 'string') return json({ reason: 'bad-request' }, 400)
      const max = body.action === 'team-limit' ? limitOf(body.maxManagers) : null
      if (body.action === 'team-limit' && !max) return json({ reason: 'bad-request' }, 400)
      const rec = await updateTeam(env, body.id, body.action === 'team-claude' ? { claude: body.on === true } : { maxManagers: max! })
      if (!rec) return json({ reason: 'not-found' }, 404)
      await audit(env, req, 'team-change', { email: me, target: `${rec.owner} ${body.action === 'team-claude' ? `claude ${body.on === true ? 'on' : 'off'}` : `max ${max}`}` })
      return teamsAnswer()
    }
    case 'team-remove': {
      if (typeof body.id !== 'string') return json({ reason: 'bad-request' }, 400)
      const rec = await readTeam(env, body.id)
      if (!rec) return json({ reason: 'not-found' }, 404)
      await removeTeam(env, rec.id, revokeTeamKeys)
      await audit(env, req, 'team-remove', { email: me, target: rec.owner })
      return teamsAnswer()
    }
    default:
      return null
  }
}

/** A customer team's owner: his managers and his own Drive link, nothing of any other team. */
async function customerOwner(env: Env, req: Request, team: Extract<Team, { isRoot: false }>, me: string, body: Record<string, unknown>): Promise<Response> {
  const rec = team.record
  if (body.action === 'disconnect') {
    await disconnectTeamDrive(env, rec.id)
    await audit(env, req, 'drive-disconnect', { email: me, target: 'team' })
    return json({ ok: true })
  }
  if (body.action === 'add' || body.action === 'remove') {
    const email = normalizeEmail(body.email)
    if (!email) return json({ reason: 'bad-email' }, 400)
    if (email === me) return json({ reason: 'owner-implicit' }, 400)
    if (body.action === 'add') {
      const added = await addMember(env, rec, email)
      if (added === 'taken') return json({ reason: 'other-team' }, 409)
      if (added === 'full') return json({ reason: 'team-full', maxManagers: rec.maxManagers }, 409)
      await audit(env, req, 'access-add', { email: me, target: email })
    } else {
      if (await removeMember(env, rec.id, email)) await audit(env, req, 'access-remove', { email: me, target: email })
    }
  } else if (body.action !== 'list') {
    return json({ reason: 'bad-action' }, 400)
  }
  return json({ owner: rec.owner, emails: await teamManagers(env, rec.id), maxManagers: rec.maxManagers, customer: true, claude: rec.claude })
}
