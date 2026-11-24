import { revokeTeamKeys } from './apiKeys.js'
import { open } from './crypto.js'
import type { Env } from './env.js'
import { revoke } from './google.js'
import { KEYS, kv } from './kv.js'
import { endAllSessions, isOwner } from './session.js'
import { removeMember, removeTeam, ROOT, type Team } from './team.js'

// "מחק את החשבון שלי" (App Store 5.1.1(v), Google Play account deletion). A manager: out of the
// allowed list, signed out everywhere, two-step secret gone. The owner: everything the server keeps
// for the app (the Drive link, every manager's access and sessions, the Claude log, API keys, worker
// form answers and forms). The owner's Drive files and calendar are deleted by the app before this
// (src/lib/deleteAccount.ts), with the owner's own token. The security log stays, trimmed to its
// last entries as always (privacy policy: kept for security).
// A customer team (api/_lib/team.ts): a manager leaves his team only; the team's owner deletes the
// whole team (his Drive link revoked, his managers signed out, its forms and keys gone). Neither
// touches the root team, and the root owner's deletion touches only root.

async function forget(env: Env, email: string) {
  await endAllSessions(env, email)
  await kv.del(env, KEYS.mfa(email), KEYS.mfaSetup(email), KEYS.sessionsOf(email))
}

export async function deleteAccount(env: Env, email: string, team: Team): Promise<void> {
  if (!team.isRoot) {
    if (team.isTeamOwner) await removeTeam(env, team.id, revokeTeamKeys)
    else await removeMember(env, team.id, email)
    await forget(env, email)
    return
  }
  if (!isOwner(env, email)) {
    await kv.remove(env, KEYS.allowed, email)
    await kv.remove(env, KEYS.assistant, email)
    await kv.remove(env, KEYS.assistantClaude, email)
    await forget(env, email)
    return
  }
  const refresh = await open<string>(env.sessionKey, await kv.get(env, KEYS.refresh))
  if (refresh) await revoke(refresh)
  await revokeTeamKeys(env, ROOT)
  for (const other of await kv.members(env, KEYS.allowed)) await forget(env, other)
  await kv.del(env, KEYS.refresh, KEYS.access, KEYS.allowed, KEYS.assistant, KEYS.claudeLog, KEYS.apiLog, KEYS.apiKeys, KEYS.joinForm, KEYS.joinSubs, KEYS.joinSent, KEYS.consForm, KEYS.consSubs, KEYS.consAnswered)
  await forget(env, email)
}
