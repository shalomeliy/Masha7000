// Reads the live app's new errors from Sentry, for the scheduled "fix new errors" session
// (docs/sentry-autofix.md). Read-only key SENTRY_AUTH_TOKEN in .env.local (Sentry > User Settings >
// Personal Tokens, Read on Project, Issue & Event, Organization). Never calls Anthropic.
//
//   node scripts/sentry-issues.mjs              new unresolved errors not handled yet, with their stack
//   node scripts/sentry-issues.mjs --resolve    the same, each frame mapped back to the source file and line
//   node scripts/sentry-issues.mjs --all        include errors already marked handled
//   node scripts/sentry-issues.mjs --mark <id>  remember an error as handled (a fix was proposed for it)
//
// The build Sentry saw is minified. --resolve rebuilds that exact commit (the event's release is the
// Vercel commit) in a temp folder with source maps, with the same public settings as Vercel, and maps
// the positions. "exact" means the rebuilt file has the same name (hash) as the live one.

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const HANDLED = join(ROOT, '.sentry-handled.local')
const ORG = 'artpeace'
const API = 'https://de.sentry.io/api/0'

function fromEnvFile(name) {
  try {
    const line = readFileSync(join(ROOT, '.env.local'), 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`))
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : ''
  } catch {
    return ''
  }
}

const token = process.env.SENTRY_AUTH_TOKEN || fromEnvFile('SENTRY_AUTH_TOKEN')
if (!token) {
  console.error('SENTRY_AUTH_TOKEN is missing in .env.local (see docs/sentry-autofix.md).')
  process.exit(1)
}

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Sentry refused ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

const handled = () => (existsSync(HANDLED) ? JSON.parse(readFileSync(HANDLED, 'utf8')) : [])

const args = process.argv.slice(2)
if (args[0] === '--mark') {
  const ids = [...new Set([...handled(), ...args.slice(1)])]
  writeFileSync(HANDLED, JSON.stringify(ids, null, 1))
  console.log(`Marked as handled: ${args.slice(1).join(', ')}`)
  process.exit(0)
}

const issues = await api(`/organizations/${ORG}/issues/?query=${encodeURIComponent('is:unresolved')}&statsPeriod=14d&sort=new&limit=25`)
const done = new Set(args.includes('--all') ? [] : handled())
const fresh = issues.filter((i) => !done.has(String(i.id)))

const tag = (e, key) => e.tags?.find((t) => t.key === key)?.value ?? ''
const report = []
for (const issue of fresh) {
  const e = await api(`/organizations/${ORG}/issues/${issue.id}/events/latest/`)
  const ex = e.entries?.find((x) => x.type === 'exception')?.data?.values ?? []
  const crumbs = e.entries?.find((x) => x.type === 'breadcrumbs')?.data?.values ?? []
  report.push({
    id: String(issue.id),
    title: issue.title,
    where: issue.culprit,
    times: Number(issue.count),
    users: issue.userCount,
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    link: issue.permalink,
    release: e.release?.version ?? tag(e, 'release'),
    browser: tag(e, 'browser'),
    os: tag(e, 'os'),
    url: tag(e, 'url') || e.request?.url || '',
    exceptions: ex.map((v) => ({
      type: v.type,
      value: v.value,
      frames: (v.stacktrace?.frames ?? []).map((f) => ({ file: f.absPath || f.filename, line: f.lineNo, column: f.colNo, fn: f.function })).reverse(),
    })),
    lastSteps: crumbs.slice(-12).map((c) => `${c.category ?? c.type}: ${c.message ?? JSON.stringify(c.data ?? {}).slice(0, 160)}`),
  })
}

if (args.includes('--resolve')) {
  const { TraceMap, originalPositionFor } = await import('@jridgewell/trace-mapping')
  const projects = await api(`/organizations/${ORG}/projects/`)
  const keys = projects[0] ? await api(`/projects/${ORG}/${projects[0].slug}/keys/`) : []
  const dsn = keys[0]?.dsn?.public ?? ''
  const builds = new Map()
  const buildOf = (sha) => {
    if (builds.has(sha)) return builds.get(sha)
    const dir = join(tmpdir(), 'masha7000-sentry', sha)
    if (!existsSync(join(dir, 'dist-map'))) {
      // A separate worktree of that commit: the shared checkout's files and branch are never touched.
      if (!existsSync(join(dir, 'package.json'))) {
        mkdirSync(join(dir, '..'), { recursive: true })
        execSync(`git worktree add --detach "${dir}" ${sha}`, { cwd: ROOT, stdio: 'ignore' })
      }
      if (!existsSync(join(dir, 'node_modules'))) {
        if (process.platform === 'win32') execSync(`mklink /J "${join(dir, 'node_modules')}" "${join(ROOT, 'node_modules')}"`, { shell: 'cmd.exe', stdio: 'ignore' })
        else execSync(`ln -s "${join(ROOT, 'node_modules')}" "${join(dir, 'node_modules')}"`)
      }
      execSync('node node_modules/vite/bin/vite.js build --sourcemap --outDir dist-map --logLevel error', {
        cwd: dir,
        stdio: 'ignore',
        env: { ...process.env, VITE_SENTRY_DSN: dsn, VITE_GOOGLE_CLIENT_ID: fromEnvFile('VITE_GOOGLE_CLIENT_ID'), VERCEL_GIT_COMMIT_SHA: sha },
      })
    }
    const out = join(dir, 'dist-map', 'assets')
    builds.set(sha, { dir, out, files: readdirSync(out) })
    return builds.get(sha)
  }
  for (const r of report) {
    if (!/^[0-9a-f]{7,40}$/.test(r.release)) {
      r.resolveNote = 'No commit on this error (built before releases were set), positions stay minified.'
      continue
    }
    try {
      const b = buildOf(r.release)
      for (const ex of r.exceptions)
        for (const f of ex.frames) {
          const live = String(f.file ?? '').match(/assets\/([^/?#]+\.js)/)?.[1]
          if (!live || !f.line) continue
          const prefix = live.replace(/-[\w-]{8}\.js$/, '-')
          const name = b.files.includes(live) ? live : b.files.find((n) => n.startsWith(prefix) && n.endsWith('.js'))
          if (!name || !existsSync(join(b.out, `${name}.map`))) continue
          const pos = originalPositionFor(new TraceMap(readFileSync(join(b.out, `${name}.map`), 'utf8')), { line: f.line, column: (f.column ?? 1) - 1 })
          if (pos.source) f.source = `${pos.source.replace(/^(\.\.\/)+/, '')}:${pos.line}${pos.name ? ` (${pos.name})` : ''}${name === live ? ' exact' : ' approximate'}`
        }
    } catch (err) {
      r.resolveNote = `Could not rebuild ${r.release}: ${String(err.message ?? err).slice(0, 200)}`
    }
  }
}

console.log(JSON.stringify({ newErrors: report.length, errors: report }, null, 2))
