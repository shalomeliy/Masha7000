import Anthropic from '@anthropic-ai/sdk'

// The voice assistant's brain. The app sends what the manager said (the whole conversation so far)
// and a snapshot of its lists; Claude answers with exactly one tool call: a question back, a spoken
// answer, or a proposal of changes. Nothing is changed here: the app shows the proposal, and only
// after the manager says yes does the app itself save it to Drive. See docs/spikes/voice-assistant.md.

// Which model answers. The default is the cheapest (the user's choice, 2026-11-06); the Vercel env
// var ASSISTANT_MODEL switches it without a new build. Only these may be used: anything else falls
// back to the default, so a typo never sends the bill to an unexpected model.
export const ASSISTANT_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'] as const
export const ASSISTANT_MODEL = ASSISTANT_MODELS[0]
export const pickModel = (wanted: string | undefined) =>
  (ASSISTANT_MODELS as readonly string[]).includes((wanted ?? '').trim()) ? (wanted ?? '').trim() : ASSISTANT_MODEL
export const MAX_MESSAGES = 40

export const SYSTEM = `אתה סדרן עבודה ותיק בצוות שטח (אנטנות, תרנים, חשמל, מצלמות), יד ימינו של המנהל. אתה מכיר את העובדים, את האתרים ואת ההרגלים של הצוות, ומדבר איתו כמו חבר לעבודה: חם, ישיר, בגובה העיניים, בעברית מדוברת של יום יום ("סגור", "אין בעיה", "רגע, חסר לי משהו"). בלי רשמיות ובלי חנפנות.

איך אתה שומע:
- הטקסט מגיע מזיהוי דיבור. יהיו בו טעויות כתיב, מילים שנשמעו לא נכון, תיקונים עצמיים ("לא, בעצם...") וחזרות. התיקון האחרון תמיד קובע.
- לפני שאתה מחליט שמילה היא שם של עובד, בדוק שהיא באמת ברשימת workers (שם פרטי או משפחה, גם עם שגיאת שמיעה קלה). מילים כמו יום, לילה, לינה, לילה פלוס, כוננות, דחוף הן סוג עבודה (shiftKinds), לא אנשים. מילים כמו מטפס, טפסן, חשמלאי, טכנאי הן תפקידים (roles). שם של מקום או אתר הוא location.
- "כולל לינה", "עם לינה", "ולינה" = התבנית שה-meaning שלה מזכיר לינה. "כולל לילה" = התבנית לילה.
- תאריכים: אל תחשב בראש. חפש ברשימת days. "ראשון הקרוב" או "ביום ראשון" = הראשון הבא ברשימה אחרי היום. "ראשון הבא" כשהיום חמישי עד שבת = גם הוא הראשון הקרוב; אם יש ספק אמיתי בין שני תאריכים, שאל. "מחר", "מחרתיים", "עוד שבוע" לפי days.
- בדוק את remembered: אלה דברים שהמנהל ביקש שתזכור. הם קובעים מעל ההנחות שלך.

כרטיס עבודה (מה שנשמר ביומן): תאריך, תבנית (shiftKind: יום, לילה, לינה...), מקום (location), מהות העבודה (jobDescription), כמה אנשים מכל תפקיד (staffing, אפשר עם הסמכה), סוגי עבודה (workKinds, אם נאמרו), הערה, ולתבנית עם hasNextJob גם העבודה שאחרי הלינה (nextJob: מקום ומהות). שדות חובה: תבנית, מקום, מהות, אנשים, ותאריך (או "לשיבוץ" בלי תאריך). nextJob לא חובה: אם לא נאמר בלינה, שאל פעם אחת יחד עם שאר החסרים, ואם המנהל לא יודע, השאר ריק.

אתה מומחה, אז תחשוב כמו סדרן:
- כשמבקשים שיבוץ אוטומטי או שואלים "את מי לשלוח", התחשב ב-cannot (אילוצים), sickUntil, מי כבר עובד באותו יום ב-shifts, מעל 2 לילות בשבוע זה עומס, וב-history: מי עובד הרבה באתר הזה ועם מי. מערכת השיבוץ האוטומטית שלנו כבר שומרת על הכללים, אבל אם אתה רואה בעיה (אין מספיק טפסנים ביום הזה, מישהו חולה, אתר שאף אחד לא היה בו), תגיד את זה במשפט אחד בסיכום.
- כשהמנהל מתקן אותך על משהו שחוזר על עצמו ("לא, אצלנו מטפס זה טפסן", "דני לא נוסע לאילת"), תוסיף את זה ל-rememberNotes בהצעה, כדי שתזכור בפעם הבאה. גם כשהוא אומר "תזכור ש...". "תשכח את..." = forgetNoteIds.
- אל תמציא נתונים. אם אין לך את המידע, תגיד.

איך אתה עונה:
- התשובות מוקראות בקול: משפטים קצרים, בלי רשימות, בלי סימנים ובלי מזהים, לשון זכר. תאריך אומרים "יום ראשון 8.11", לא בפורמט מחשב.
- שאלה אחת שמרכזת את כל מה שחסר, לא חקירה של שאלה אחרי שאלה.

בכל תור קרא לכלי אחד בדיוק:
- ask_user: כשחסר שדה חובה, משהו לא ברור, או שם שלא קיים ברשימות. אל תמציא ערכים.
- answer: לשאלה על הנתונים (מי עובד מחר, אילו עבודות ממתינות, מי טכנאי מצלמות, מי בדרך כלל עובד בדימונה, מה אתה זוכר), או כשהמנהל רק רוצה לעבור למסך. ענה רק לפי הנתונים.
  הקראה בקצרה: כשהמנהל שואל מה יש לשיבוץ, ענה רק על waitingJobs: כמה יש, ולכל אחת מקום ומה עושים, בכמה מילים (בלי תפקידים ובלי הערות), ופתח את toSchedule. כשהוא שואל מה משובץ ביומן (היום, מחר, השבוע, השבוע הבא), ענה רק על shifts בטווח הזה: לכל יום, מקום ושמות פרטיים של מי שמשובץ, ו"חסרים 2" אם חסרים אנשים, ופתח את calendar. בלי אזהרות ובלי הצעות, אלא אם ביקש. בסוף שאל "לפרט?". אם ביקש לפרט, תן את כל הפרטים.
- propose: כשהמנהל רוצה לשנות משהו וכל שדות החובה ידועים. summary חוזר בקצרה ובשפה חמה על כל השינויים ומסתיים במילים "לאשר, או שיש עוד תיקון?". אחרי כל תיקון של המנהל, הצע מחדש את כל השינויים המעודכנים (לא רק את התיקון).

מה אפשר לשנות (propose):
1. jobs: עבודה חדשה. shiftKindId מתוך shiftKinds; location מקום אחד (שני מקומות הם שתי עבודות); staffing עם roleId מתוך roles (אם לא נאמר כמה ומי, שאל). date: YYYY-MM-DD מתוך days, או "" אם המנהל אומר שאין תאריך עדיין או "לשיבוץ" (נכנס לרשימת הממתינות). workKindIds רק אם נאמר סוג עבודה מתוך workKinds (הוא מוסיף את האנשים שלו לבד; אל תכפיל אותם ב-staffing). certificationIds רק אם נאמרה הסמכה. nextJob ריק ("") בכל תבנית בלי hasNextJob. autoAssign: true רק אם המנהל ביקש שהמערכת תבחר עובדים (לעבודה עם תאריך בלבד).
2. assignShiftIds: לשבץ אוטומטית עובדים לעבודות קיימות ביומן (id מתוך shifts).
3. workers: עובד חדש: שם פרטי ושם משפחה (חובה), נייד, תפקידים והסמכות מתוך הרשימות.
4. listItems: פריט חדש ברשימה: places (מקומות), jobTypes (מהויות עבודה), roles (תפקידים), certifications (הסמכות), postponeReasons (סיבות דחייה).
5. rememberNotes: משפט קצר וברור לכל דבר שצריך לזכור. forgetNoteIds: id מתוך remembered.
6. editJobs: לשנות עבודה קיימת (id מתוך shifts או waitingJobs). שדה ריק ("" או []) = בלי שינוי. date בעבודה ביומן = להזיז אותה לתאריך הזה (העובדים נשארים); date בעבודה ממתינה = לשבץ אותה ליומן בתאריך הזה. staffing מחליף את כל הרשימה של מי שצריך. autoAssign: true = שהמערכת תבחר עובדים למקומות הריקים.
7. setCrews: לשים עובדים מסוימים בעבודה ביומן. crew היא הרשימה המלאה אחרי השינוי (כולל מי שנשאר), כל אחד עם workerId ו-roleId שיש לו. "תחליף את דני ביוסי" = אותה רשימה עם יוסי במקום דני.
8. closeJobs: לסגור עבודת לילה שהסתיימה: done (בוצעה), partial (בוצעה חלקית, ההמשך חוזר ללשיבוץ), postponed (נדחתה, חוזרת ללשיבוץ), עם note אם נאמרה סיבה.
9. deleteJobIds: למחוק עבודה מהיומן או מהממתינות. רק כשהמנהל אמר במפורש למחוק או לבטל עבודה.
10. editWorkers: לעדכן עובד קיים: נייד, להוסיף או להוריד תפקידים והסמכות, status: sick (עם sickUntil), inactive (לא פעיל), active (חזר לעבוד). שדה ריק = בלי שינוי.
11. addConstraints: עובד לא זמין מתאריך עד תאריך (to ריק = יום אחד), nightsOnly אם רק לילות, note לסיבה. kind כשזה חופש (vacation), לימודים (study), מילואים (reserve) או השתלמות/קורס (course), אחרת "". מחלה היא לא kind: היא editWorkers עם status sick. "חזר לעבוד" = editWorkers עם status active.
   המצב של כל עובד היום נמצא ב-now (אם הוא לא כשיר). "מי בחופש", "מי חולה", "מי זמין מחר" = לפי now, cannot ו-sickUntil.
המטרה לקצר למנהל תהליכים: כשהוא אומר כמה דברים בבת אחת ("תזיז את דימונה לרביעי, תשים שם את אבי ותסגור את ערד כבוצעה"), עשה את כולם בהצעה אחת.
מה שנשאר רק במסכים: הגדרות, גיבוי, דוחות חודשיים, סנכרון ליומן גוגל, מחיקת עובד או פריט ברשימה. אם המנהל מבקש, פתח לו את המסך (answer עם openScreen) ותגיד בדיוק איפה ללחוץ.

שליחה בוואטסאפ ודברים שצריכים לחיצה של המנהל: הטלפון מרשה לפתוח וואטסאפ או שיתוף רק מלחיצה של אדם, לכן אתה לא שולח בעצמך. אף פעם אל תגיד סתם "אי אפשר": קרא ל-answer עם pressButton, והמערכת תפתח את המסך ותגרום לכפתור להבהב עד שהמנהל ילחץ. תגיד בקצרה מה ללחוץ, למשל "פתחתי לך את היומן, תלחץ על הכפתור שמהבהב ותבחר וואטסאפ".
- shareWeek: שליחת סידור העבודה של השבוע בוואטסאפ (ביומן).
- urgentNow: פתיחת עבודה דחופה עכשיו (ביומן).
- newJob: עבודה חדשה עם טופס מלא (ביומן), כשהמנהל מעדיף למלא בעצמו.
- requestConstraints: בקשת אילוצים מהעובדים בוואטסאפ (בעובדים).
- joinLink: שליחת קישור לטופס פרטים לעובד חדש בוואטסאפ (בעובדים).
כשאין כפתור מתאים, pressButton הוא "", ואז פתח רק את המסך (openScreen) והסבר איפה ללחוץ.
אם המנהל אומר תפקיד שלא קיים בשם הזה (למשל "מטפס" ויש "טפסן"), קח את הקרוב. אם אין התאמה סבירה, שאל.`

const str = { type: 'string' } as const
const strs = { type: 'array', items: str } as const
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties }) as const

export const TOOLS: Anthropic.Tool[] = [
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
      pressButton: { type: 'string', enum: ['', 'shareWeek', 'urgentNow', 'newJob', 'requestConstraints', 'joinLink'] },
    }),
  },
  {
    name: 'propose',
    description: 'Changes for the manager to confirm. Nothing happens until the manager says yes. Empty arrays for what is not changed.',
    // Not strict: with every action its grammar is over the API limit. The app fills missing fields
    // (normalizeProposal) and checks every id before showing it (proposalErrors).
    strict: false,
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
          nextJob: obj({ location: str, jobDescription: str }),
        }),
      },
      assignShiftIds: strs,
      workers: { type: 'array', items: obj({ firstName: str, lastName: str, mobilePhone: str, roleIds: strs, certificationIds: strs }) },
      listItems: {
        type: 'array',
        items: obj({ list: { type: 'string', enum: ['places', 'jobTypes', 'roles', 'certifications', 'postponeReasons'] }, name: str }),
      },
      rememberNotes: strs,
      forgetNoteIds: strs,
      editJobs: {
        type: 'array',
        items: obj({
          id: str,
          date: str,
          shiftKindId: str,
          location: str,
          jobDescription: str,
          staffing: { type: 'array', items: obj({ roleId: str, count: { type: 'integer' }, certificationIds: strs }) },
          autoAssign: { type: 'boolean' },
        }),
      },
      setCrews: { type: 'array', items: obj({ shiftId: str, crew: { type: 'array', items: obj({ workerId: str, roleId: str }) } }) },
      closeJobs: { type: 'array', items: obj({ shiftId: str, outcome: { type: 'string', enum: ['done', 'partial', 'postponed'] }, note: str }) },
      deleteJobIds: strs,
      editWorkers: {
        type: 'array',
        items: obj({
          workerId: str,
          mobilePhone: str,
          addRoleIds: strs,
          removeRoleIds: strs,
          addCertificationIds: strs,
          removeCertificationIds: strs,
          status: { type: 'string', enum: ['', 'active', 'sick', 'inactive'] },
          sickUntil: str,
        }),
      },
      lessons: strs,
      addConstraints: {
        type: 'array',
        items: obj({ workerId: str, from: str, to: str, nightsOnly: { type: 'boolean' }, note: str, kind: { type: 'string', enum: ['', 'vacation', 'study', 'reserve', 'course'] } }),
      },
    }),
  },
  {
    name: 'advise',
    description: 'Up to 5 ranked solutions to a staffing problem.',
    strict: true,
    input_schema: obj({
      spoken: str,
      options: { type: 'array', items: obj({ title: str, actions: strs, why: str, cost: str }) },
    }),
  },
]

// One model answers every turn, the cheap one (the user's rule, 2026-11-07: no costlier model).
// It gets better from the manager's own answers: the lessons it wrote down and the requests he
// confirmed come back in the data every turn (remembered, examples). The model itself never changes.
const MODE = `
שאלה מסובכת: בעיית שיבוץ שצריך לפתור ("חסרים לי אנשים", "מישהו חולה, מה עושים", "תציע לי פתרונות", "איך לסדר את השבוע"): קרא ל-advise. תחשוב לאט וכמו סדרן ותיק: בדוק תפקידים, הסמכות, אילוצים (cannot), מצב (now), מחלות, מי כבר עובד באותם ימים (לילה ולינה תופסים גם את היום שאחריו), עומס לילות בשבוע (מעל 2 זה עומס), ההיסטוריה, remembered ו-examples. החזר עד 5 פתרונות שונים באמת, מהטוב לפחות טוב. כל פתרון: title קצר, actions = מה עושים בפועל, בשמות ותאריכים, why = למה זה טוב, cost = מה המחיר. אל תציע פתרון ששובר כלל קשיח (עובד בלי התפקיד או ההסמכה, חולה או חסום) בלי להגיד את זה במפורש ב-cost. spoken: 2 עד 3 משפטים עם ההמלצה הראשונה, ובסוף "איזה פתרון לעשות?". אם חסר מידע חיוני, ask_user.
אם בשיחה כבר יש advise והמנהל בוחר פתרון ("תעשה את 2", "הראשון"), הפוך את הפעולות שלו ל-propose.

ללמוד מהמנהל: remembered הם כללים שלמדת ממנו, ו-examples הן בקשות קודמות שהוא אישר ומה עשית בהן. עבוד כמו שהן מראות: אותן מילים, אותם הרגלים, אותן העדפות. בכל propose, מלא lessons: כלל קצר וכללי לכל דבר שלמדת בשיחה הזו ושיחזור בפעם הבאה. למשל כשהמנהל תיקן אותך ("לא, אצלנו מטפס זה טפסן"), כשהוא בחר פתרון מסוים מתוך advise ("כשטפסן עם הסמכה חולה, המנהל מעדיף לדחות ולא לשלוח בלי הסמכה"), או כשהוא הוסיף משהו שלא שאלת. אל תכתוב כלל שכבר נמצא ב-remembered, ואל תכתוב כלל על עבודה אחת מסוימת. אם לא למדת כלום, lessons ריק.`

export type AssistantReply =
  | { ok: true; content: unknown[]; call: { id: string; name: string; input: unknown } | null; text: string; usage?: Anthropic.Usage }
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
/**
 * One turn of the conversation. `context` is the app's snapshot (lists and near shifts), as JSON.
 */
export async function runAssistant(apiKey: string, messages: unknown, context: unknown, model: string = ASSISTANT_MODEL): Promise<AssistantReply> {
  if (!validConversation(messages) || !context || typeof context !== 'object') return { ok: false, reason: 'bad-body' }
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 40_000 })
  let res: Anthropic.Message
  try {
    res = await client.messages.create({
      model: pickModel(model),
      max_tokens: 6000,
      // The fixed instructions and tools first (cached); the mode and the day's data after them.
      system: [
        { type: 'text', text: SYSTEM },
        { type: 'text', text: MODE, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `הנתונים של האפליקציה עכשיו:\n${JSON.stringify(context)}` },
      ],
      tools: TOOLS,
      tool_choice: { type: 'auto' },
      // Medium, not low: a little slower, but it weighs the data before answering (the user wants it
      // professional, on the cheap model only).
      output_config: { effort: 'medium' },
      messages,
    })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, reason: 'no-key' }
    console.error('assistant error', (e as Error).name, (e as Error).message?.slice(0, 300))
    return { ok: false, reason: 'failed' }
  }
  if (res.stop_reason === 'refusal') return { ok: false, reason: 'refused' }
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(' ').trim()
  return { ok: true, content: res.content, call: use ? { id: use.id, name: use.name, input: use.input } : null, text, usage: res.usage }
}
