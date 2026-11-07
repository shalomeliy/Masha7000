// Live check of the whole flow on the one (cheap) model: a hard problem -> advise -> pick -> propose.
// Throwaway spike for the phase 2 advisor: given a hard staffing problem, does the model return up to
// 5 ranked, correct, doable solutions from the app's snapshot? Haiku vs Sonnet.
// Run: LIVE=1 npx vitest run spikes/advisor/advisor.live.test.ts --dir . --silent=false
import { readFileSync } from 'node:fs'
import { it } from 'vitest'
import { runAssistant } from '../../api/_lib/assistant'
import { normalizeProposal, proposalErrors } from '../../src/lib/assistant'
import { userTurn, type Turn } from '../../src/lib/assistantApi'
import { snapshot, type AppData } from '../../src/lib/assistant'
import type { ShiftRecord, Worker } from '../../src/types/models'

const env = Object.fromEntries(
  readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)

const w = (id: string, firstName: string, lastName: string, roleIds: string[], extra: Partial<Worker> = {}): Worker => ({ id, firstName, lastName, roleIds, certificationIds: [], constraints: [], ...extra })
const sh = (id: string, date: string, kind: string, location: string, job: string, crew: [string, string][], staffing: string[] = []): ShiftRecord => ({
  id, date, shiftDefinitionId: kind, location, jobDescription: job, crew: crew.map(([workerId, roleId]) => ({ workerId, roleId })), staffing: staffing.map((roleId) => ({ roleId })),
})

// Today Friday 6.11. The week of 8.11 is tight on climbers and has one electrician.
const data: AppData = {
  roles: [{ id: 'general', name: 'כללי' }, { id: 'r1', name: 'טפסן' }, { id: 'r2', name: 'חשמלאי' }, { id: 'r3', name: 'טכנאי אנטנות' }, { id: 'r4', name: 'טכנאי מצלמות' }],
  certifications: [{ id: 'c1', name: 'אנטנה בגובה 40 מטר' }],
  workers: [
    w('w1', 'דני', 'לוי', ['r1'], { certificationIds: ['c1'] }),
    w('w2', 'יוסי', 'כהן', ['r1']),
    w('w3', 'רון', 'מזרחי', ['r4']),
    w('w4', 'אבי', 'פרץ', ['r2', 'r1'], { constraints: [{ id: 'k', when: 'dates', from: '2026-11-09', to: '2026-11-09' }] }),
    w('w5', 'משה', 'לינדה', ['r3']),
    w('w6', 'עומר', 'שלום', ['r1'], { certificationIds: ['c1'], status: 'sick', sickUntil: '2026-11-10' }),
    w('w7', 'גיל', 'בן דוד', ['r1', 'r3']),
  ],
  shiftDefinitions: [
    { id: 's1', name: 'יום', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00' },
    { id: 's2', name: 'לילה', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00', endsNextDay: true },
    { id: 'night-plus', name: 'לינה', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00', endsNextDay: true, thenJob: true },
  ],
  shifts: [
    sh('h1', '2026-10-20', 's2', 'אילת אתר 123', 'החלפת אנטנה', [['w1', 'r1'], ['w2', 'r1']]),
    sh('h2', '2026-10-27', 's1', 'אילת אתר 123', 'תחזוקה', [['w1', 'r1'], ['w3', 'r4']]),
    sh('h3', '2026-11-02', 's2', 'דימונה 556', 'מצלמות', [['w3', 'r4'], ['w7', 'r1']]),
    sh('h4', '2026-11-04', 's2', 'ערד 77', 'אנטנה', [['w7', 'r1'], ['w2', 'r1']]),
    // The coming week
    sh('n1', '2026-11-08', 'night-plus', 'אילת אתר 123', 'החלפת אנטנה בגובה 40', [['w1', 'r1'], ['w2', 'r1']], ['r1', 'r1']),
    sh('n2', '2026-11-09', 's1', 'דימונה 556', 'חיבור חשמל לתורן', [], ['r2', 'r1']),
    sh('n3', '2026-11-10', 's2', 'מצפה רמון 9', 'החלפת אנטנה בגובה 40', [], ['r1', 'r1']),
    sh('n4', '2026-11-10', 's2', 'ערד 77', 'תיקון קרינה', [['w7', 'r1']], ['r1', 'r3']),
  ],
  pendingJobs: [
    { id: 'pj1', location: 'באר שבע 12', jobDescription: 'החלפת מצלמה', staffing: [{ roleId: 'r4' }], reasonIds: [], createdAt: '2026-11-01T00:00:00Z' },
    { id: 'pj2', location: 'ירוחם', jobDescription: 'בדיקת קרינה', staffing: [{ roleId: 'r3' }, { roleId: 'r1' }], shiftDefinitionId: 's2', reasonIds: [], createdAt: '2026-11-02T00:00:00Z' },
  ],
  places: [{ id: 'p1', name: 'אילת אתר 123' }, { id: 'p2', name: 'דימונה 556' }],
  jobTypes: [],
  workKinds: [],
  postponeReasons: [],
  assistantNotes: [{ id: 'n1', text: 'יוסי לא עולה לגובה 40 בלי דני לידו', createdAt: '' }],
  assistantExamples: [],
  departments: [],
}


const NOW = new Date('2026-11-06T20:00:00')
const ctx = snapshot(data, NOW)
type A = { content: Record<string, unknown>[]; call: { id: string; name: string; input: Record<string, unknown> } | null; text: string }

async function turn(conv: Turn[], label: string): Promise<A> {
  const t = Date.now()
  const r = await runAssistant(env.ANTHROPIC_API_KEY, conv, ctx, 'claude-haiku-5-5')
  if (!r.ok) throw new Error(`${label}: ${r.reason}`)
  const a = r as unknown as A & { usage: { input_tokens: number; output_tokens: number } }
  console.log(`
[${label}] ${((Date.now() - t) / 1000).toFixed(1)}s in=${a.usage.input_tokens} out=${a.usage.output_tokens} blocks=${a.content.map((b) => b.type).join(',')}
  ${a.call?.name}: ${JSON.stringify(a.call?.input).slice(0, 1500)}`)
  conv.push({ role: 'assistant', content: a.content })
  return a
}

it.skipIf(!process.env.LIVE)('whole flow', { timeout: 300_000 }, async () => {
  const conv: Turn[] = [{ role: 'user', content: process.env.SAY ?? 'דני חולה, הוא לא יכול לצאת ביום ראשון לאילת. מה עושים?' }]
  let a = await turn(conv, 'ask')
  if (a.call?.name !== 'advise') return
  const first = (a.call.input.options as { title: string }[])[0].title
  conv.push(userTurn(a as never, `תעשה את פתרון 1: ${first}`))
  a = await turn(conv, 'pick')
  if (a.call?.name === 'propose') console.log('  errors:', proposalErrors(normalizeProposal(a.call.input), data))
})

for (const said of (process.env.CMDS ?? '').split('|').filter(Boolean)) {
  it.skipIf(!process.env.LIVE)(said, { timeout: 120_000 }, async () => {
    const a = await turn([{ role: 'user', content: said }], 'cmd')
    if (a.call?.name === 'propose') console.log('  errors:', proposalErrors(normalizeProposal(a.call.input), data))
  })
}
