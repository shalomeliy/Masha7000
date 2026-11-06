import Anthropic from '@anthropic-ai/sdk'

// The voice assistant's brain. The app sends what the manager said (the whole conversation so far)
// and a snapshot of its lists; Claude answers with exactly one tool call: a question back, a spoken
// answer, or a proposal of changes. Nothing is changed here: the app shows the proposal, and only
// after the manager says yes does the app itself save it to Drive. See docs/spikes/voice-assistant.md.

// The cheapest model: these are short, simple requests (the user's choice, 2026-11-06).
export const ASSISTANT_MODEL = 'claude-haiku-5-5'
export const MAX_MESSAGES = 40

const SYSTEM = `אתה העוזר הקולי של אפליקציית שיבוץ עבודות של צוות שטח (אנטנות, חשמל, מצלמות). מדבר איתך המנהל.
הטקסט מגיע מזיהוי דיבור: יכולות להיות בו טעויות כתיב, מילים שנשמעו לא נכון, תיקונים עצמיים ("לא, בעצם...") וחזרות. התיקון האחרון תמיד קובע.
התשובות שלך מוקראות בקול: עברית פשוטה, לשון זכר, משפטים קצרים, בלי רשימות, בלי סימנים ובלי מזהים. תאריך אומרים כך: "יום ראשון 8.11".

בכל תור קרא לכלי אחד בדיוק:
- ask_user: כשחסר שדה חובה, או שמשהו לא ברור, או שם שלא קיים ברשימות. שאל על כל מה שחסר בהודעה אחת קצרה. אל תמציא ערכים.
- answer: לשאלה על הנתונים (מי עובד מחר, אילו עבודות ממתינות, מי טכנאי מצלמות, מה הטלפון של מישהו), או כשהמנהל רק רוצה לעבור למסך. ענה רק לפי הנתונים שבהמשך. אם אין לך את המידע, אמור זאת.
- propose: כשהמנהל רוצה לשנות משהו וכל שדות החובה ידועים. summary חוזר בקצרה על כל השינויים ומסתיים במילים "לאשר, או שיש עוד תיקון?". אחרי כל תיקון של המנהל, הצע מחדש את כל השינויים המעודכנים (לא רק את התיקון).

מה אפשר לשנות (propose):
1. jobs: עבודה חדשה. שדות חובה: shiftKindId (תבנית מתוך shiftKinds; "לינה" או "לילה פלוס" זה התבנית לינה), location (מקום אחד; שני מקומות הם שתי עבודות), jobDescription (מהות העבודה), staffing (כמה אנשים מכל תפקיד, roleId מתוך roles; אם לא נאמר, שאל).
   date: YYYY-MM-DD. "מחר", "ביום שלישי" מחושבים מהיום (today). אם לא נאמר תאריך, שאל. רק אם המנהל אומר שאין תאריך עדיין או "לשיבוץ", date הוא "" והעבודה נכנסת לרשימת הממתינות.
   workKindIds רק אם נאמר סוג עבודה מתוך workKinds (הוא מוסיף את האנשים שלו לבד; אל תכפיל אותם ב-staffing). certificationIds ב-staffing רק אם נאמרה הסמכה.
   autoAssign: true רק אם המנהל ביקש שהמערכת תבחר עובדים (לעבודה עם תאריך בלבד).
2. assignShiftIds: לשבץ אוטומטית עובדים לעבודות קיימות ביומן (id מתוך shifts).
3. workers: עובד חדש: שם פרטי ושם משפחה (חובה), נייד, תפקידים והסמכות מתוך הרשימות.
4. listItems: פריט חדש ברשימה: places (מקומות), jobTypes (מהויות עבודה), roles (תפקידים), certifications (הסמכות), postponeReasons (סיבות דחייה).
אי אפשר כרגע למחוק, לערוך עובד קיים או לשנות הגדרות בקול. אם המנהל מבקש, אמור שזה עוד לא אפשרי בקול ופתח לו את המסך המתאים (answer עם openScreen).
אם המנהל אומר "מטפס" ואין תפקיד בשם הזה, התכוון לתפקיד הקרוב (טפסן). אם אין התאמה סבירה, שאל.`

const str = { type: 'string' } as const
const strs = { type: 'array', items: str } as const
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties }) as const

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'ask_user',
    description: 'Ask the manager for what is missing or unclear, in one short spoken Hebrew message.',
    strict: true,
    input_schema: obj({ question: str }),
  },
  {
    name: 'answer',
    description: 'A spoken Hebrew answer to a question about the data, optionally opening a screen of the app.',
    strict: true,
    input_schema: obj({
      text: str,
      openScreen: { type: 'string', enum: ['', 'calendar', 'toSchedule', 'workers', 'archive', 'settings'] },
    }),
  },
  {
    name: 'propose',
    description: 'Changes for the manager to confirm. Nothing happens until the manager says yes. Empty arrays for what is not changed.',
    strict: true,
    input_schema: obj({
      summary: str,
      jobs: {
        type: 'array',
        items: obj({
          date: str,
          shiftKindId: str,
          location: str,
          jobDescription: str,
          staffing: { type: 'array', items: obj({ roleId: str, count: { type: 'integer' }, certificationIds: strs }) },
          workKindIds: strs,
          note: str,
          autoAssign: { type: 'boolean' },
        }),
      },
      assignShiftIds: strs,
      workers: { type: 'array', items: obj({ firstName: str, lastName: str, mobilePhone: str, roleIds: strs, certificationIds: strs }) },
      listItems: {
        type: 'array',
        items: obj({ list: { type: 'string', enum: ['places', 'jobTypes', 'roles', 'certifications', 'postponeReasons'] }, name: str }),
      },
    }),
  },
]

export type AssistantReply =
  | { ok: true; content: unknown[]; call: { id: string; name: string; input: unknown } | null; text: string }
  | { ok: false; reason: 'bad-body' | 'refused' | 'no-key' | 'failed' }

/** True when the conversation has the shape the API needs: user first, roles alternating, small enough. */
export function validConversation(messages: unknown): messages is Anthropic.MessageParam[] {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return false
  return messages.every(
    (m, i) =>
      m && typeof m === 'object' && (m.role === (i % 2 === 0 ? 'user' : 'assistant')) && (typeof m.content === 'string' || Array.isArray(m.content)),
  ) && messages.length % 2 === 1
}

/** One turn of the conversation. `context` is the app's snapshot (lists and near shifts), as JSON. */
export async function runAssistant(apiKey: string, messages: unknown, context: unknown): Promise<AssistantReply> {
  if (!validConversation(messages) || !context || typeof context !== 'object') return { ok: false, reason: 'bad-body' }
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 25_000 })
  let res: Anthropic.Message
  try {
    res = await client.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 4000,
      // The fixed instructions and tools first (cached); the day's data after them.
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `הנתונים של האפליקציה עכשיו:\n${JSON.stringify(context)}` },
      ],
      tools: TOOLS,
      tool_choice: { type: 'auto' },
      output_config: { effort: 'low' },
      messages,
    })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, reason: 'no-key' }
    console.error('assistant error', (e as Error).name)
    return { ok: false, reason: 'failed' }
  }
  if (res.stop_reason === 'refusal') return { ok: false, reason: 'refused' }
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(' ').trim()
  return { ok: true, content: res.content, call: use ? { id: use.id, name: use.name, input: use.input } : null, text }
}
