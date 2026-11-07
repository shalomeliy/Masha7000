// Reads the voice assistant's "what went to Claude" log from the live site, for a development session
// that teaches the next free action (skill free-commands). No sign-in: it uses the read-only key
// CLAUDE_LOG_TOKEN (the same value in Vercel env and in .env.local, at least 32 characters).
// Never calls Anthropic.
//
//   node scripts/claude-log.mjs            the log as JSON, oldest first
//   node scripts/claude-log.mjs --last 20  only the last 20 conversations

import { readFileSync } from 'node:fs'

function fromEnvFile(name) {
  try {
    const line = readFileSync('.env.local', 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`))
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : ''
  } catch {
    return ''
  }
}

const token = process.env.CLAUDE_LOG_TOKEN || fromEnvFile('CLAUDE_LOG_TOKEN')
const origin = process.env.APP_ORIGIN || fromEnvFile('APP_ORIGIN') || 'https://masha7000.vercel.app'
if (token.length < 32) {
  console.error('CLAUDE_LOG_TOKEN is missing (or shorter than 32 characters) in .env.local. The owner can also copy the log in Settings.')
  process.exit(1)
}
const res = await fetch(`${origin}/api/claude-log`, { headers: { Authorization: `Bearer ${token}` } })
if (!res.ok) {
  console.error(`The server refused: ${res.status} ${await res.text()}`)
  process.exit(1)
}
const { entries } = await res.json()
const at = process.argv.indexOf('--last')
const n = at > 0 ? Number(process.argv[at + 1]) : 0
console.log(JSON.stringify(n > 0 ? entries.slice(-n) : entries, null, 2))
