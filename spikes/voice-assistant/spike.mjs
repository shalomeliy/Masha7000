// Throwaway spike: can Claude turn a spoken Hebrew request into a job card for this app,
// ask for exactly the fields that are missing, take corrections, and stay cheap enough?
// Run: node spikes/voice-assistant/spike.mjs [haiku|sonnet|both]
// Needs ANTHROPIC_API_KEY=... in .env.local (gitignored). Nothing here touches Drive.
import { readFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'

const env = Object.fromEntries(
  readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)
if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing in .env.local')
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

const MODELS = {
  haiku: { id: 'claude-haiku-5-5', inUsd: 0.1, outUsd: 0.5 },
  sonnet: { id: 'claude-sonnet-5-5', inUsd: 2, outUsd: 10 },
}

// A catalog shaped like the app's Drive lists (ids + names only, which is what the server would get).
const catalog = {
  today: '2026-11-06 (יום שישי)',
  roles: [
    { id: 'general', name: 'כללי' },
    { id: 'r1', name: 'טפסן' },
    { id: 'r2', name: 'חשמלאי' },
    { id: 'r3', name: 'טכנאי אנטנות' },
    { id: 'r4', name: 'טכנאי מצלמות' },
    { id: 'r5', name: 'מנהל טיפוס' },
  ],
  certifications: [
    { id: 'c1', name: 'אנטנה עד גובה 20 מטר' },
    { id: 'c2', name: 'אנטנה בגובה 40 מטר' },
    { id: 'c3', name: 'חשמלאי מוסמך' },
  ],
  shiftKinds: [
    { id: 's1', name: 'יום', note: 'עבודת בוקר, נגמרת ב-16:00 באותו יום' },
    { id: 's2', name: 'לילה', note: 'עבודת לילה, נגמרת ב-16:00 למחרת' },
    { id: 's3', name: 'לילה+', note: 'לינה: עבודת לילה ואחריה עבודה נוספת לפני החזרה לבסיס' },
  ],
  workKinds: [
    { id: 'k1', name: 'טיפוס', staffing: 'מנהל טיפוס + 2 טפסנים' },
    { id: 'k2', name: 'ריתוך', staffing: 'אדם אחד עם הסמכת רתך' },
  ],
  jobDescriptions: ['החלפת מצלמה', 'התקנת אנטנה', 'תחזוקה שוטפת'],
  places: ['אילת אתר 123', 'דימונה אתר 556', 'באר שבע אתר 12'],
}

const SYSTEM = `אתה העוזר הקולי של אפליקציית שיבוץ עבודות של צוות שטח (אנטנות, חשמל, מצלמות).
המנהל מדבר בעברית מדוברת; הטקסט מגיע מזיהוי דיבור ויכול להכיל טעויות, תיקונים עצמיים ("לא, בעצם...") וחזרות. התיקון האחרון תמיד קובע.

כרטיס עבודה ("לשיבוץ") מכיל:
- date: תאריך YYYY-MM-DD (חובה). "מחר", "ביום שלישי" וכו' מחושבים מהיום.
- shiftKindId: תבנית העבודה מתוך shiftKinds (חובה). "לינה" = לילה+.
- location: מקום אחד (חובה). שני מקומות = שני כרטיסים נפרדים.
- jobDescription: מהות העבודה (חובה).
- staffing: רשימת אנשים: לכל תפקיד roleId וכמות. תפקיד מותר רק מתוך roles. אם אמרו "מטפס" זה התפקיד "טפסן".
- workKindIds: סוגי עבודה מתוך workKinds, רק אם נאמרו.
- note: הערה חופשית, לא חובה.

כל תור אתה קורא לכלי אחד בדיוק:
- ask_user: כשחסר שדה חובה, או שמשהו לא ברור או לא קיים ברשימות. שאל על כל החסר בהודעה אחת קצרה, בלשון זכר, בלי להמציא ערכים.
- propose_jobs: כשכל שדות החובה ידועים. summary הוא משפט קצר שיוקרא בקול ויסתיים בשאלה "לאשר, או שיש עוד תיקון?".
אל תמציא תאריך, תבנית או מהות עבודה שלא נאמרו. אם נאמר תפקיד שלא ברשימה, שאל.

הרשימות של האפליקציה:
${JSON.stringify(catalog, null, 1)}`

const tools = [
  {
    name: 'ask_user',
    description: 'Ask the manager for what is missing or unclear, in one short spoken Hebrew message.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['question', 'missing'],
      properties: {
        question: { type: 'string' },
        missing: { type: 'array', items: { type: 'string', enum: ['date', 'shiftKind', 'location', 'jobDescription', 'staffing', 'other'] } },
      },
    },
  },
  {
    name: 'propose_jobs',
    description: 'Propose the job cards to create, for the manager to confirm. Not executed until confirmed.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'jobs'],
      properties: {
        summary: { type: 'string' },
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['date', 'shiftKindId', 'location', 'jobDescription', 'staffing', 'workKindIds', 'note'],
            properties: {
              date: { type: 'string' },
              shiftKindId: { type: 'string' },
              location: { type: 'string' },
              jobDescription: { type: 'string' },
              staffing: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['roleId', 'count'],
                  properties: { roleId: { type: 'string' }, count: { type: 'integer' } },
                },
              },
              workKindIds: { type: 'array', items: { type: 'string' } },
              note: { type: 'string' },
            },
          },
        },
      },
    },
  },
]

// The user's own example, then two follow-ups a manager would plausibly say.
const SCRIPT = [
  'אני צריך 3 מטפסים, לא בעצם מספיק לי 2 מטפסים וטכנאי מצלמות 1 לאילת אתר 123 וגם אתר דימונה 556, ואם חסר לך עוד ידע תשאל אותי',
  'ביום ראשון, לינה, החלפת מצלמה',
  'תוסיף גם חשמלאי אחד רק לדימונה',
]

async function run(key) {
  const m = MODELS[key]
  const messages = []
  let cost = 0
  console.log(`\n===== ${m.id} =====`)
  for (const said of SCRIPT) {
    messages.push({ role: 'user', content: said })
    const t0 = Date.now()
    const res = await client.messages.create({
      model: m.id,
      max_tokens: 4000,
      system: SYSTEM,
      tools,
      tool_choice: { type: 'auto' },
      output_config: { effort: 'low' },
      messages,
    })
    const ms = Date.now() - t0
    cost += (res.usage.input_tokens * m.inUsd + res.usage.output_tokens * m.outUsd) / 1e6
    console.log(`\n> מנהל: ${said}`)
    console.log(`  (${ms}ms, in ${res.usage.input_tokens}, out ${res.usage.output_tokens}, stop ${res.stop_reason})`)
    const call = res.content.find((b) => b.type === 'tool_use')
    if (!call) {
      console.log('  !! no tool call:', res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' '))
      break
    }
    console.log(`  ${call.name}:`, JSON.stringify(call.input, null, 1).replace(/\n/g, '\n  '))
    messages.push({ role: 'assistant', content: res.content })
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: 'המנהל ענה בהודעה הבאה.' }] })
  }
  console.log(`\n  total cost for 3 turns: $${cost.toFixed(4)}`)
}

const which = process.argv[2] ?? 'both'
for (const k of which === 'both' ? ['haiku', 'sonnet'] : [which]) await run(k)
