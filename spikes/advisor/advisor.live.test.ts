// Throwaway spike for the phase 2 advisor: given a hard staffing problem, does the model return up to
// 5 ranked, correct, doable solutions from the app's snapshot? Haiku vs Sonnet.
// Run: LIVE=1 npx vitest run spikes/advisor/advisor.live.test.ts --dir . --silent=false
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'
import { assertPaidCallAllowed } from '../../api/_lib/spendGuard.js'
import { it } from 'vitest'
import { SYSTEM, TOOLS } from '../../api/_lib/assistant'
import { snapshot, type AppData } from '../../src/lib/assistant'
import type { ShiftRecord, Worker } from '../../src/types/models'

const env = Object.fromEntries(
  (existsSync(new URL('../../.env.local', import.meta.url)) ? readFileSync(new URL('../../.env.local', import.meta.url), 'utf8') : '')
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
  pendingJobs: [],
  places: [{ id: 'p1', name: 'אילת אתר 123' }, { id: 'p2', name: 'דימונה 556' }],
  jobTypes: [],
  workKinds: [],
  postponeReasons: [],
  assistantNotes: [{ id: 'n1', text: 'יוסי לא עולה לגובה 40 בלי דני לידו' }],
  departments: [],
}

const ADVISE = `

יועץ: כשהמנהל מתאר בעיה (חסרים אנשים, מישהו חולה, התנגשות, עומס, "מה לעשות", "תציע לי"), קרא ל-advise. תחשוב לעומק כמו סדרן ותיק: בדוק תפקידים, הסמכות, אילוצים, מחלות, מי כבר עובד באותם ימים (לילה תופס גם את היום שאחריו), עומס לילות בשבוע (מעל 2 זה עומס), ההיסטוריה ומה שביקשו שתזכור. החזר עד 5 פתרונות שונים באמת, מהטוב לפחות טוב. כל פתרון: מה עושים בפועל, למה הוא טוב, ומה המחיר שלו. אל תציע פתרון ששובר כלל קשיח (עובד בלי התפקיד או ההסמכה הדרושים, עובד חולה או חסום) בלי להגיד את זה במפורש. spoken: 2-3 משפטים שמוקראים בקול עם ההמלצה הראשונה.`

const ADVISE_TOOL: Anthropic.Tool = {
  name: 'advise',
  description: 'Up to 5 ranked solutions for a staffing problem.',
  input_schema: {
    type: 'object',
    required: ['spoken', 'options'],
    properties: {
      spoken: { type: 'string' },
      options: { type: 'array', items: { type: 'object', required: ['title', 'actions', 'why', 'cost'], properties: { title: { type: 'string' }, actions: { type: 'array', items: { type: 'string' } }, why: { type: 'string' }, cost: { type: 'string' } } } },
    },
  },
}

const PROBLEMS = [
  'דני חולה, הוא לא יכול לצאת ביום ראשון לאילת. מה עושים?',
  'ביום שלישי יש לי שתי עבודות לילה, במצפה רמון ובערד, ואין לי מספיק טפסנים. תציע לי פתרונות',
  'אבי לא יכול ביום שני והוא החשמלאי היחיד, ויש לי את דימונה שצריכה חשמלאי. מה לעשות?',
]
const PRICE: Record<string, [number, number]> = { 'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10] }
const out: string[] = []

for (const model of process.env.MODEL ? [process.env.MODEL] : ['claude-haiku-5-5', 'claude-sonnet-5-5']) {
  it.skipIf(!process.env.LIVE)(model, { timeout: 300_000 }, async () => {
    assertPaidCallAllowed()
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
    let cost = 0
    for (const said of PROBLEMS) {
      const t = Date.now()
      const res = await client.messages.create({
        model,
        max_tokens: 6000,
        system: [{ type: 'text', text: SYSTEM + ADVISE }, { type: 'text', text: `הנתונים של האפליקציה עכשיו:\n${JSON.stringify(snapshot(data, new Date('2026-11-06T20:00:00')))}` }],
        tools: [...TOOLS, ADVISE_TOOL],
        output_config: { effort: 'medium' },
        messages: [{ role: 'user', content: said }],
      })
      const u = res.usage
      cost += (u.input_tokens * PRICE[model][0] + u.output_tokens * PRICE[model][1]) / 1e6
      const call = res.content.find((b) => b.type === 'tool_use')
      out.push(`\n### [${model}] ${said}\n${((Date.now() - t) / 1000).toFixed(1)}s in=${u.input_tokens} out=${u.output_tokens}\n${call?.type === 'tool_use' ? `${call.name}: ${JSON.stringify(call.input, null, 1)}` : 'no tool'}`)
    }
    out.push(`\n[${model}] total ≈ $${cost.toFixed(4)} for ${PROBLEMS.length} problems`)
    writeFileSync(new URL(`./result-${model}.md`, import.meta.url), out.join('\n'))
  })
}
