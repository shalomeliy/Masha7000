// Throwaway live check for assistant v2: real model calls through the real prompt and snapshot.
// Run: npx vitest run spikes/voice-assistant/v2.live.test.ts  (needs ANTHROPIC_API_KEY in .env.local)
// Costs a few cents. Not part of `npm test` (vitest only collects src/ by default config? it is
// skipped unless LIVE=1).
import { readFileSync } from 'node:fs'
import { it } from 'vitest'
import { runAssistant } from '../../api/_lib/assistant'
import { snapshot, type AppData } from '../../src/lib/assistant'
import type { ShiftRecord, Worker } from '../../src/types/models'

const env = Object.fromEntries(
  readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)

const w = (id: string, firstName: string, lastName: string, roleIds: string[], extra: Partial<Worker> = {}): Worker => ({ id, firstName, lastName, roleIds, certificationIds: [], constraints: [], ...extra })
const sh = (id: string, date: string, kind: string, location: string, job: string, crew: [string, string][]): ShiftRecord => ({
  id, date, shiftDefinitionId: kind, location, jobDescription: job, crew: crew.map(([workerId, roleId]) => ({ workerId, roleId })), staffing: [],
})

const data: AppData = {
  roles: [{ id: 'general', name: 'כללי' }, { id: 'r1', name: 'טפסן' }, { id: 'r2', name: 'חשמלאי' }, { id: 'r3', name: 'טכנאי אנטנות' }, { id: 'r4', name: 'טכנאי מצלמות' }],
  certifications: [{ id: 'c1', name: 'אנטנה בגובה 40 מטר' }],
  workers: [
    w('w1', 'דני', 'לוי', ['r1'], { certificationIds: ['c1'] }),
    w('w2', 'יוסי', 'כהן', ['r1']),
    w('w3', 'רון', 'מזרחי', ['r4']),
    w('w4', 'אבי', 'פרץ', ['r2', 'r1'], { constraints: [{ id: 'k', when: 'dates', from: '2026-11-08', to: '2026-11-09' }] }),
    w('w5', 'משה', 'לינדה', ['r3']),
  ],
  shiftDefinitions: [
    { id: 's1', name: 'יום', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00' },
    { id: 's2', name: 'לילה', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00', endsNextDay: true },
    { id: 'night-plus', name: 'לינה', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00', endsNextDay: true, thenJob: true },
  ],
  shifts: [
    sh('h1', '2026-10-20', 's2', 'אילת אתר 123', 'החלפת אנטנה', [['w1', 'r1'], ['w2', 'r1']]),
    sh('h2', '2026-10-27', 's1', 'אילת אתר 123', 'תחזוקה', [['w1', 'r1'], ['w3', 'r4']]),
    sh('h3', '2026-11-02', 's1', 'דימונה 556', 'מצלמות', [['w3', 'r4']]),
    sh('h4', '2026-11-10', 's1', 'באר שבע', 'תחזוקה', []),
  ],
  pendingJobs: [],
  places: [{ id: 'p1', name: 'אילת אתר 123' }, { id: 'p2', name: 'דימונה 556' }],
  jobTypes: [{ id: 'j1', name: 'החלפת אנטנה' }],
  workKinds: [],
  postponeReasons: [],
  assistantNotes: [],
  departments: [],
}

const NOW = new Date('2026-11-06T20:00:00')
const SCRIPTS = process.env.SAY ? [process.env.SAY] : [
  'תפתח עבודה ראשון הקרוב כולל לינה באילת אתר 123 החלפת אנטנה שני מטפסים',
  'מחר עבודת יום בדימונה 556 תחזוקת מצלמות טכנאי מצלמות אחד ותשבץ לי מישהו',
  'מי בדרך כלל עובד באילת?',
  'תזכור שאבי לא עושה לילות בכלל',
  'אני צריך את משה ולינה ביום שלישי',
]
const PRICE: Record<string, [number, number]> = { 'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10] } // $ per 1M tokens, from the v1 spike

for (const model of process.env.MODEL ? [process.env.MODEL] : ['claude-haiku-5-5', 'claude-sonnet-5-5']) {
  it.skipIf(!process.env.LIVE)(model, { timeout: 120_000 }, async () => {
    let cost = 0
    for (const said of SCRIPTS) {
      const t = Date.now()
      const r = await runAssistant(env.ANTHROPIC_API_KEY, [{ role: 'user', content: said }], snapshot(data, NOW), model)
      if (!r.ok) { console.log(model, said, 'FAILED', r.reason); continue }
      const u = r.usage!
      const inTok = u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1
      cost += (inTok * PRICE[model][0] + u.output_tokens * PRICE[model][1]) / 1e6
      console.log(`\n[${model}] ${said}\n  ${((Date.now() - t) / 1000).toFixed(1)}s in=${u.input_tokens} out=${u.output_tokens}\n  ${r.call?.name}: ${JSON.stringify(r.call?.input)}`)
    }
    console.log(`\n[${model}] total ≈ $${cost.toFixed(4)} for ${SCRIPTS.length} turns`)
  })
}
