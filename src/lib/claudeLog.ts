// The "what went to Claude" log (the user's request, 2026-11-07). Every conversation the voice
// assistant sent to Claude is kept with why the free path did not do it, what Claude did, and how it
// ended. A developer reads it (Settings > "מה הלך ל-Claude" > copy, or `node scripts/claude-log.mjs`)
// and teaches the next free action with the skill free-commands. Kept on the server (api/claude-log.ts,
// owner only, sealed), and the last ones on this device too, so a failed send is not lost.

export type LogOutcome = 'pending' | 'answered' | 'confirmed' | 'cancelled' | 'failed'

export interface ClaudeLogEntry {
  id: string
  at: string // when the conversation started (ISO)
  lang: string // the app's language code
  said: string[] // what the manager said in it, in order
  reason: string // why the first sentence was not done free (freeCommands.whyNotFree)
  understood: string // what the free path did understand of it
  did: string[] // what Claude did, one line per answer ("propose: ...", "answer: ...")
  outcome: LogOutcome
  learned: string // on a yes: the action type learned from it ('job', 'sick'), or '' when nothing could be learned
}

export const LOG_MAX = 300
const LOCAL_KEY = 'assistant.claudeLog'
const LOCAL_MAX = 100
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** The entry as the server keeps it: short texts, at most 20 lines each. */
export function trimEntry(e: ClaudeLogEntry): ClaudeLogEntry {
  return {
    ...e,
    said: e.said.slice(0, 20).map((s) => cut(s, 400)),
    reason: cut(e.reason, 400),
    understood: cut(e.understood, 400),
    did: e.did.slice(-20).map((s) => cut(s, 500)),
  }
}

function readLocal(): ClaudeLogEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as unknown
    return Array.isArray(list) ? (list as ClaudeLogEntry[]) : []
  } catch {
    return []
  }
}

function writeLocal(list: ClaudeLogEntry[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(-LOCAL_MAX)))
  } catch {
    // no storage: the server copy still has it
  }
}

/** Adds the entry or replaces the one with its id, here and on the server (never waits, never throws). */
export function saveEntry(entry: ClaudeLogEntry) {
  const e = trimEntry(entry)
  writeLocal([...readLocal().filter((x) => x.id !== e.id), e])
  fetch('/api/claude-log', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry: e }),
  }).catch(() => {})
}

/** The whole log: from the server, or this device's copy when the server cannot be reached. */
export async function loadLog(): Promise<{ entries: ClaudeLogEntry[]; fromServer: boolean }> {
  try {
    const res = await fetch('/api/claude-log', { credentials: 'same-origin' })
    if (res.ok) {
      const data = (await res.json()) as { entries?: ClaudeLogEntry[] }
      if (Array.isArray(data.entries)) return { entries: data.entries, fromServer: true }
    }
  } catch {
    // offline
  }
  return { entries: readLocal(), fromServer: false }
}

/** Empties the log on the server and here. False when the server refused. */
export async function clearLog(): Promise<boolean> {
  writeLocal([])
  try {
    const res = await fetch('/api/claude-log', { method: 'DELETE', credentials: 'same-origin' })
    return res.ok
  } catch {
    return false
  }
}

/** The log as plain text, to paste into a development conversation. */
export function logText(entries: ClaudeLogEntry[]): string {
  const head = `Shaly voice assistant: what went to Claude (${entries.length} conversations, oldest first)`
  const body = entries.map((e, i) =>
    [
      `#${i + 1} ${e.at.slice(0, 16).replace('T', ' ')} UTC | lang ${e.lang} | ${e.outcome}${e.outcome === 'confirmed' ? ` | learned: ${e.learned || 'nothing (not a learnable action)'}` : ''}`,
      ...e.said.map((s, k) => `  said${e.said.length > 1 ? ` ${k + 1}` : ''}: ${s}`),
      `  why not free: ${e.reason}`,
      `  understood: ${e.understood}`,
      ...e.did.map((s) => `  Claude: ${s}`),
    ].join('\n'),
  )
  return [head, ...body].join('\n\n')
}
