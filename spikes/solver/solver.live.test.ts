// Throwaway spike: the code solves a "worker missing from a job" problem in milliseconds and the
// model only recognizes the problem (and, in variant B, ranks and words it). Measures the time.
// Run: LIVE=1 npx vitest run spikes/solver/solver.live.test.ts --dir . --silent=false
import { readFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'
import { it } from 'vitest'
import { SYSTEM } from '../../api/_lib/assistant'
import { snapshot, type AppData } from '../../src/lib/assistant'
import { generalRoleId, staffingFor } from '../../src/lib/catalog'
import { autoAssign } from '../../src/lib/planner'
import { addDays, dayName, moveShift, showDate } from '../../src/lib/shifts'
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
    { ...sh('n1', '2026-11-08', 'night-plus', 'אילת אתר 123', 'החלפת אנטנה בגובה 40', [['w1', 'r1'], ['w2', 'r1']]), staffing: [{ roleId: 'r1', certificationIds: ['c1'] }, { roleId: 'r1' }] },
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

interface Option { title: string; actions: string[]; why: string; cost: string }

/** Options for a job some workers drop out of: replace them, move the job, or go short. */
function solveMissing(d: AppData, shiftId: string, missing: string[]): Option[] {
  const shift = d.shifts.find((s) => s.id === shiftId)!
  const general = generalRoleId(d.roles)
  const staffing = staffingFor(shift.staffing, d.roles, d.certifications.map((c) => c.id))
  const workers = d.workers.filter((w) => !missing.includes(w.id))
  const ctx = { workers, records: d.shifts, defs: d.shiftDefinitions, generalId: general }
  const name = (id: string) => d.workers.find((w) => w.id === id)?.firstName ?? ''
  const where = shift.location || shift.jobDescription
  const out: Option[] = []
  const kept = shift.crew.filter((c) => !missing.includes(c.workerId))
  const replace = autoAssign({ ...shift, crew: kept }, staffing, ctx)
  const added = replace.crew.filter((c) => !kept.some((k) => k.workerId === c.workerId)).map((c) => name(c.workerId))
  if (!replace.unfilled.length) {
    out.push({
      title: `להכניס את ${added.join(' ו')} במקום`,
      actions: [`ב${where} ביום ${dayName(shift.date)} ${showDate(shift.date)}: ${replace.crew.map((c) => name(c.workerId)).join(', ')}`],
      why: 'העבודה יוצאת בזמן, וכל מי שנכנס מחזיק בתפקיד ובהסמכה ופנוי',
      cost: 'אין',
    })
  }
  for (let i = 1; i <= 10; i++) {
    const date = addDays(shift.date, i)
    const moved = { ...moveShift(shift, date), crew: [] as ShiftRecord['crew'] }
    const plan = autoAssign(moved, staffing, { ...ctx, workers: d.workers.filter((w) => !missing.includes(w.id) || i > 2) })
    if (!plan.unfilled.length) {
      out.push({
        title: `להזיז ליום ${dayName(date)} ${showDate(date)}`,
        actions: [`להזיז את ${where} ל-${showDate(date)}`, `לשבץ: ${plan.crew.map((c) => name(c.workerId)).join(', ')}`],
        why: 'צוות מלא עם כל ההסמכות',
        cost: `העבודה מתעכבת ${i === 1 ? 'ביום' : `ב-${i} ימים`}`,
      })
      break
    }
  }
  if (replace.unfilled.length && replace.crew.length) {
    out.push({
      title: 'לצאת בצוות חסר',
      actions: [`ב${where}: ${replace.crew.map((c) => name(c.workerId)).join(', ')}`],
      why: 'העבודה יוצאת בזמן',
      cost: `חסר ${replace.unfilled.length === 1 ? 'אדם אחד' : `${replace.unfilled.length} אנשים`}: ${replace.why[0] ?? ''}`,
    })
  }
  return out.slice(0, 3)
}

const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties }) as const
const SOLVE: Anthropic.Tool = {
  name: 'solve_missing',
  description: 'A worker (or several) cannot do a job in the calendar: the app computes the options itself.',
  strict: true,
  input_schema: obj({ shiftId: { type: 'string' }, missingWorkerIds: { type: 'array', items: { type: 'string' } } }),
}
const ADVISE: Anthropic.Tool = {
  name: 'advise',
  description: 'The options to show, ranked, 1 to 3.',
  strict: true,
  input_schema: obj({ spoken: { type: 'string' }, order: { type: 'array', items: { type: 'integer' } }, notes: { type: 'array', items: { type: 'string' } } }),
}
const MODE = 'כשעובד לא יכול לעבוד בעבודה ביומן ("דני חולה, מי יחליף אותו בראשון"), אל תפתור בעצמך: קרא מיד ל-solve_missing עם id העבודה מ-shifts ו-id העובדים מ-workers. האפליקציה תחשב את האפשרויות.'

async function call(client: Anthropic, system: string, messages: Anthropic.MessageParam[], tools: Anthropic.Tool[], label: string) {
  const t = Date.now()
  const res = await client.messages.create({ model: 'claude-haiku-5-5', max_tokens: 2000, system, tools, tool_choice: { type: 'any' }, output_config: { effort: 'low' }, messages })
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')!
  console.log(`[${label}] ${((Date.now() - t) / 1000).toFixed(1)}s out=${res.usage.output_tokens} ${use.name}: ${JSON.stringify(use.input).slice(0, 600)}`)
  return { res, use, ms: Date.now() - t }
}

it.skipIf(!process.env.LIVE)('code solves, model words', { timeout: 120_000 }, async () => {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const ctx = JSON.stringify(snapshot(data, NOW))
  const system = `${SYSTEM}\n${MODE}\nהנתונים של האפליקציה עכשיו:\n${ctx}`
  const said = 'דני חולה, הוא לא יכול לצאת ביום ראשון לאילת. מה עושים?'
  const one = await call(client, system, [{ role: 'user', content: said }], [SOLVE, ADVISE], 'recognize')
  const input = one.use.input as { shiftId: string; missingWorkerIds: string[] }
  const t = performance.now()
  const options = solveMissing(data, input.shiftId, input.missingWorkerIds)
  console.log(`[solve] ${(performance.now() - t).toFixed(1)}ms\n${options.map((o, i) => `  ${i + 1}. ${o.title} | ${o.actions.join(' / ')} | ${o.why} | ${o.cost}`).join('\n')}`)
  // Variant A: the code's own wording, no second call. Variant B: the model ranks and words.
  const list = options.map((o, i) => `${i + 1}. ${o.title}: ${o.actions.join('; ')}. ${o.why}. מחיר: ${o.cost}`).join('\n')
  const two = await call(
    client,
    system,
    [
      { role: 'user', content: said },
      { role: 'assistant', content: one.res.content },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: one.use.id,
            content: `האפשרויות שהאפליקציה חישבה (אל תמציא אחרות):\n${list}\nקרא ל-advise: order = מספרי האפשרויות מהטובה לפחות טובה, אחרי שבדקת אותן מול remembered; notes = הערה קצרה לכל אחת אם יש בעיה שהאפליקציה לא יודעת (למשל מ-remembered); spoken = 1 עד 2 משפטים עם ההמלצה.`,
          },
        ],
      },
    ],
    [SOLVE, ADVISE],
    'word',
  )
  console.log(`[total A] ${(one.ms / 1000).toFixed(1)}s   [total B] ${((one.ms + two.ms) / 1000).toFixed(1)}s`)
})
