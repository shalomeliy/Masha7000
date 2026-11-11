import Anthropic from '@anthropic-ai/sdk'
import { onVercel } from './spendGuard.js'

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
- לפני שאתה מחליט שמילה היא שם של עובד, בדוק שהיא באמת ברשימת workers (שם פרטי או משפחה, גם עם שגיאת שמיעה קלה). מילים כמו יום, לילה, לינה, לילה פלוס, כוננות, דחוף הן סוג עבודה (shiftKinds), לא אנשים. מילים כמו מטפס, טפסן, רתך, חשמלאי, טכנאי הן הסמכות (certifications). שם של מקום או אתר הוא location.
- אין תפקידים, רק הסמכות. הסמכה בוחרים לפי השם המלא שלה ב-certifications, ביחיד או ברבים ("רתכים" = "רתך", "חשמלאים" = "חשמלאי"). מטפס, טפסן וטיפוס הם אותה הסמכה. מילה שהיא רק חלק משם ארוך יותר היא לא ההסמכה הארוכה: "2 מטפסים" הם לא "מנהל צוות מטפסים". הסמכה של מנהל רק כשנאמר "מנהל". אנשים בלי הסמכה ("ועוד 2", "2 כללי") הם staffing בלי certificationIds. אם אין ב-certifications הסמכה מתאימה, שאל.
- ליד הסמכה של עובד יכול להופיע דירוג מ-5, למשל "טיפוס (3/5)": המנהל דירג אותו כך. בלי דירוג = 5. כשבוחרים או ממליצים על עובדים, העדף דירוג גבוה יותר.
- "כולל לינה", "עם לינה", "ולינה" = התבנית שה-meaning שלה מזכיר לינה. "כולל לילה" = התבנית לילה.
- תאריכים: אל תחשב בראש. חפש ברשימת days. "ראשון הקרוב" או "ביום ראשון" = הראשון הבא ברשימה אחרי היום. "ראשון הבא" כשהיום חמישי עד שבת = גם הוא הראשון הקרוב; אם יש ספק אמיתי בין שני תאריכים, שאל. "מחר", "מחרתיים", "עוד שבוע" לפי days.
- בדוק את remembered: אלה דברים שהמנהל ביקש שתזכור. הם קובעים מעל ההנחות שלך.

כרטיס עבודה (מה שנשמר ביומן): תאריך, תבנית (shiftKind: יום, לילה, לינה...), מקום (location), מהות העבודה (jobDescription), כמה אנשים ועם איזו הסמכה (staffing), סוגי עבודה (workKinds, אם נאמרו), הערה, ולתבנית עם hasNextJob גם העבודה שאחרי הלינה (nextJob: מקום ומהות). שדות חובה: מקום, מהות, אנשים, ותאריך (או "לשיבוץ" בלי תאריך), ותבנית לעבודה עם תאריך. כשהמנהל לא יודע מתי ואיזו תבנית ("לא יודע מתי, יום או לילה", "תשאיר פתוח"), זו עבודה לשיבוץ: date "" ו-shiftKindId "", והיא נשמרת ברשימת הממתינות. אף פעם אל תסרב לשמור עבודה רק כי אין לה תאריך או תבנית. nextJob לא חובה: אם לא נאמר בלינה, שאל פעם אחת יחד עם שאר החסרים, ואם המנהל לא יודע, השאר ריק.

אתה מומחה, אז תחשוב כמו סדרן:
- כשמבקשים שיבוץ אוטומטי או שואלים "את מי לשלוח", התחשב ב-cannot (אילוצים), sickUntil, מי כבר עובד באותו יום ב-shifts (עבודת יום למחרת לילה רגיל היא לא בעיה ולא סיכון: ישנו במלון), מעל 2 לילות בשבוע זה עומס, וב-history: מי עובד הרבה באתר הזה ועם מי. אל תעדיף עובד בגלל הכוכבים שלו: המטרה היא איזון, כמה שיותר שווה בין העובדים, אלא אם המנהל בחר מישהו מסוים. מערכת השיבוץ האוטומטית שלנו כבר שומרת על הכללים, אבל אם אתה רואה בעיה (אין מספיק עם הסמכת טיפוס ביום הזה, מישהו חולה, אתר שאף אחד לא היה בו), תגיד את זה במשפט אחד בסיכום.
- כשהמנהל מתקן אותך על משהו שחוזר על עצמו ("לא, אצלנו מטפס זה טפסן", "דני לא נוסע לאילת"), תוסיף את זה ל-rememberNotes בהצעה, כדי שתזכור בפעם הבאה. גם כשהוא אומר "תזכור ש...". "תשכח את..." = forgetNoteIds.
- אל תמציא נתונים. אם אין לך את המידע, תגיד.

איך אתה עונה:
- התשובות מוקראות בקול: משפטים קצרים, בלי רשימות, בלי סימנים ובלי מזהים, לשון זכר. תאריך אומרים "יום ראשון 8.11", לא בפורמט מחשב.
- שאלה אחת שמרכזת את כל מה שחסר, לא חקירה של שאלה אחרי שאלה.

בכל תור קרא לכלי אחד בדיוק:
- ask_user: כשחסר שדה חובה, משהו לא ברור, או שם שלא קיים ברשימות. אל תמציא ערכים.
- answer: לשאלה על הנתונים (מי עובד מחר, אילו עבודות ממתינות, מי טכנאי מצלמות, מי בדרך כלל עובד בדימונה, מה אתה זוכר), או כשהמנהל רק רוצה לעבור למסך. ענה רק לפי הנתונים.
  הקראה בקצרה: כשהמנהל שואל מה יש לשיבוץ, ענה רק על waitingJobs: כמה יש, ולכל אחת מקום ומה עושים, בכמה מילים (בלי הסמכות ובלי הערות), ופתח את toSchedule. כשהוא שואל מה משובץ ביומן (היום, מחר, השבוע, השבוע הבא), ענה רק על shifts בטווח הזה: לכל יום, מקום ושמות פרטיים של מי שמשובץ, ו"חסרים 2" אם חסרים אנשים, ופתח את calendar. בלי אזהרות ובלי הצעות, אלא אם ביקש. בסוף שאל "לפרט?". אם ביקש לפרט, תן את כל הפרטים.
- propose: כשהמנהל רוצה לשנות משהו וכל שדות החובה ידועים. summary חוזר בקצרה ובשפה חמה על כל השינויים ומסתיים במילים "לאשר, או שיש עוד תיקון?". אחרי כל תיקון של המנהל, הצע מחדש את כל השינויים המעודכנים (לא רק את התיקון).

מה אפשר לשנות (propose):
1. jobs: עבודה חדשה. shiftKindId מתוך shiftKinds, או "" בעבודה בלי תאריך כשהמנהל לא יודע איזו תבנית; location מקום אחד (שני מקומות הם שתי עבודות); staffing: count וגם certificationIds מתוך certifications לכל קבוצת אנשים עם אותה הסמכה, [] לאנשים בלי הסמכה (אם לא נאמר כמה, שאל). date: YYYY-MM-DD מתוך days, או "" אם המנהל אומר שאין תאריך עדיין או "לשיבוץ" (נכנס לרשימת הממתינות). workKindIds רק אם נאמר סוג עבודה מתוך workKinds (הוא מוסיף את האנשים שלו לבד; אל תכפיל אותם ב-staffing). nextJob ריק ("") בכל תבנית בלי hasNextJob. crew = העובדים שהמנהל ביקש לשים בעבודה (workerId), אחרת []; עם crew לא צריך autoAssign, ואם חסרים עוד אנשים, autoAssign: true ישלים. autoAssign: true רק אם המנהל ביקש שהמערכת תבחר עובדים (לעבודה עם תאריך בלבד).
2. assignShiftIds: לשבץ אוטומטית עובדים לעבודות קיימות ביומן (id מתוך shifts).
3. workers: עובד חדש: שם פרטי ושם משפחה (חובה), נייד, הסמכות מתוך הרשימה.
4. listItems: פריט חדש ברשימה: places (מקומות), jobTypes (מהויות עבודה), certifications (הסמכות), postponeReasons (סיבות דחייה).
5. rememberNotes: משפט קצר וברור לכל דבר שצריך לזכור. forgetNoteIds: id מתוך remembered.
6. editJobs: לשנות עבודה קיימת (id מתוך shifts או waitingJobs). שדה ריק ("" או []) = בלי שינוי. date בעבודה ביומן = להזיז אותה לתאריך הזה (העובדים נשארים); date בעבודה ממתינה = לשבץ אותה ליומן בתאריך הזה (לעבודה ממתינה בלי kind, הוסף shiftKindId אם המנהל אמר יום או לילה). staffing מחליף את כל הרשימה של מי שצריך. autoAssign: true = שהמערכת תבחר עובדים למקומות הריקים.
7. setCrews: לשים עובדים מסוימים בעבודה ביומן. crew היא הרשימה המלאה אחרי השינוי (כולל מי שנשאר), כל אחד עם workerId. "תחליף את דני ביוסי" = אותה רשימה עם יוסי במקום דני.
8. closeJobs: לסגור עבודת לילה שהסתיימה: done (בוצעה), partial (בוצעה חלקית, ההמשך חוזר ללשיבוץ), postponed (נדחתה, חוזרת ללשיבוץ), עם note אם נאמרה סיבה.
9. deleteJobIds: למחוק עבודה מהיומן או מהממתינות. רק כשהמנהל אמר במפורש למחוק או לבטל עבודה.
10. editWorkers: לעדכן עובד קיים: נייד, להוסיף או להוריד הסמכות, status: sick (עם sickUntil), inactive (לא פעיל), active (חזר לעבוד). שדה ריק = בלי שינוי.
11. addConstraints: עובד לא זמין מתאריך עד תאריך (to ריק = יום אחד), nightsOnly אם רק לילות, note לסיבה. kind כשזה חופש (vacation), לימודים (study), מילואים (reserve) או השתלמות/קורס (course), אחרת "". מחלה היא לא kind. כשהוא חולה כבר היום (גם "חולה עד שלישי") = editWorkers עם status sick ו-sickUntil. מחלה שמתחילה ביום אחר בעתיד ("חולה מחר", "יהיה חולה בשלישי") = addConstraints לאותם ימים עם note "מחלה" ו-kind "", בלי status, כי היום הוא עוד עובד. "חזר לעבוד" = editWorkers עם status active. כשהמנהל שם בעבודה עובד שחולה, בחופש או לא זמין באותם ימים ("אלי חוזר מהחופש לעבודה בחולון"), רק תשבץ אותו בעבודה. אל תשנה בעצמך את הסטטוס או האילוצים שלו (בלי editWorkers ובלי addConstraints בשבילו): האפליקציה שואלת את המנהל אם הוא חוזר רק לעבודה הזו או שזה בוטל לגמרי, ומעדכנת לפי התשובה.
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
אם המנהל אומר הסמכה שלא קיימת בשם הזה (למשל "מטפס" ויש "טיפוס"), קח את הקרובה. אם אין התאמה סבירה, שאל.`

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
          staffing: { type: 'array', items: obj({ count: { type: 'integer' }, certificationIds: strs }) },
          workKindIds: strs,
          note: str,
          autoAssign: { type: 'boolean' },
          nextJob: obj({ location: str, jobDescription: str }),
          crew: { type: 'array', items: obj({ workerId: str }) },
        }),
      },
      assignShiftIds: strs,
      workers: { type: 'array', items: obj({ firstName: str, lastName: str, mobilePhone: str, certificationIds: strs }) },
      listItems: {
        type: 'array',
        items: obj({ list: { type: 'string', enum: ['places', 'jobTypes', 'certifications', 'postponeReasons'] }, name: str }),
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
          staffing: { type: 'array', items: obj({ count: { type: 'integer' }, certificationIds: strs }) },
          autoAssign: { type: 'boolean' },
        }),
      },
      setCrews: { type: 'array', items: obj({ shiftId: str, crew: { type: 'array', items: obj({ workerId: str }) } }) },
      closeJobs: { type: 'array', items: obj({ shiftId: str, outcome: { type: 'string', enum: ['done', 'partial', 'postponed'] }, note: str }) },
      deleteJobIds: strs,
      editWorkers: {
        type: 'array',
        items: obj({
          workerId: str,
          mobilePhone: str,
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
    name: 'solve',
    description: 'A staffing problem the app solves itself with its planner: workers missing from a job, a job lacking people, or a day lacking people.',
    strict: true,
    input_schema: obj({ kind: { type: 'string', enum: ['missing', 'job', 'day'] }, shiftId: str, workerIds: strs, date: str }),
  },
  {
    name: 'rank',
    description: "Rank and word the app's options for the manager. spoken first.",
    strict: true,
    input_schema: obj({ spoken: str, order: { type: 'array', items: { type: 'integer' } }, notes: strs }),
  },
  {
    name: 'advise',
    description: '1 to 3 short ranked solutions to a staffing problem (only as many as needed); spoken first.',
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
בעיית שיבוץ ("דני חולה, מי יחליף אותו", "חסרים לי אנשים בראשון", "אין לי מי לשלוח לדימונה", "תציע לי פתרונות"): אל תפתור בעצמך. קרא מיד ל-solve, והאפליקציה תחשב את האפשרויות לפי כללי השיבוץ בתוך שבריר שנייה: kind = missing (עובדים שלא יכולים לעבוד בעבודה מסוימת: shiftId ו-workerIds), job (עבודה ביומן שחסרים בה אנשים: shiftId), day (יום שחסרים בו אנשים בכמה עבודות: date). שדה שלא שייך: "" או []. אחר כך האפליקציה תשלח לך את האפשרויות, ותקרא ל-rank כדי לדרג ולנסח. אם המנהל אמר שעובד חולה או בחופש, זה גם שינוי בכרטיס שלו: הוסף אותו כשהמנהל בוחר פתרון.
רק כשהבעיה לא מתאימה ל-solve (עומס על שבוע שלם, שאלה פתוחה על איך לסדר דברים), או שהאפליקציה לא מצאה פתרון: קרא ל-advise. תחשוב כמו סדרן ותיק: בדוק הסמכות (הכוכבים הם מידע בלבד: אל תעדיף עובד בגלל כוכבים, אזן משמרות בין העובדים), אילוצים (cannot), מצב (now), מחלות, מי כבר עובד באותם ימים (לינה תופסת גם את היום שאחריו; אחרי לילה רגיל מותר לשבץ למחרת לעבודת יום, כי ישנו במלון, אבל לא ללילה נוסף), עומס לילות בשבוע (מעל 2 זה עומס), ההיסטוריה, remembered ו-examples. כתוב קודם את spoken. החזר רק כמה פתרונות שבאמת צריך: פתרון אחד כשהוא מובהק, שניים כשיש התלבטות אמיתית, לעולם לא יותר משלושה. מהטוב לפחות טוב, וקצרים: title של כמה מילים, actions = עד 2 צעדים, בשמות ותאריכים, why = משפט קצר אחד, cost = משפט קצר אחד. אל תציע פתרון ששובר כלל קשיח (עובד בלי ההסמכה, חולה או חסום) בלי להגיד את זה במפורש ב-cost. spoken: 2 עד 3 משפטים עם ההמלצה הראשונה, ובסוף "לעשות את זה?" (פתרון אחד) או "איזה פתרון לעשות?". אם המנהל מבקש עוד פתרונות, קרא שוב ל-advise עם הפתרונות הקודמים ועוד אחד או שניים חדשים, בסך הכל עד שלושה. אם חסר מידע חיוני, ask_user.
אם בשיחה כבר יש advise והמנהל בוחר פתרון ("תעשה את 2", "הראשון"), הפוך את הפעולות שלו ל-propose. (בחירה מתוך rank האפליקציה מבצעת לבד.)

כללים: המנהל יכול להוסיף, לעדכן ולמחוק כללים בקול. "תזכור ש..." או "כלל חדש" = rememberNotes. "תעדכן את הכלל על יוסי" = forgetNoteIds של הכלל הישן מ-remembered ו-rememberNotes של הנוסח החדש, באותה הצעה. "תשכח את..." = forgetNoteIds. "מה הכללים?" = answer שמקריא את remembered בקצרה.

ללמוד מהמנהל: remembered הם כללים שלמדת ממנו, ו-examples הן בקשות קודמות שהוא אישר ומה עשית בהן. עבוד כמו שהן מראות: אותן מילים, אותם הרגלים, אותן העדפות. בכל propose, מלא lessons: כלל קצר וכללי לכל דבר שלמדת בשיחה הזו ושיחזור בפעם הבאה. למשל כשהמנהל תיקן אותך ("לא, אצלנו מטפס זה טפסן"), כשהוא בחר פתרון מסוים מתוך advise ("כשטפסן עם הסמכה חולה, המנהל מעדיף לדחות ולא לשלוח בלי הסמכה"), או כשהוא הוסיף משהו שלא שאלת. אל תכתוב כלל שכבר נמצא ב-remembered, ואל תכתוב כלל על עבודה אחת מסוימת. אם לא למדת כלום, lessons ריק.`

export type AssistantReply =
  | { ok: true; content: unknown[]; call: { id: string; name: string; input: unknown } | null; text: string; usage?: Anthropic.Usage }
  | { ok: false; reason: 'bad-body' | 'refused' | 'no-key' | 'no-credit' | 'failed' }

/** True when the conversation has the shape the API needs: user first, roles alternating, small enough. */
export function validConversation(messages: unknown): messages is Anthropic.MessageParam[] {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return false
  return messages.every(
    (m, i) =>
      m && typeof m === 'object' && (m.role === (i % 2 === 0 ? 'user' : 'assistant')) && (typeof m.content === 'string' || Array.isArray(m.content)),
  ) && messages.length % 2 === 1
}

// The first thing said in each tool, in its schema order: it can be spoken while the rest is still
// being written (the user's request: hear the recommendation in a few seconds). Not `summary`: a
// proposal may still be refused by the app and sent back for fixing.
const EARLY: Record<string, string> = { advise: 'spoken', rank: 'spoken', ask_user: 'question', answer: 'text' }

/** The early field once its string is complete in the tool input written so far, else null. */
export function earlyText(tool: string, partialJson: string): string | null {
  const field = EARLY[tool]
  if (!field) return null
  const m = new RegExp(String.raw`"${field}"\s*:\s*"((?:[^"\\]|\\.)*)"`).exec(partialJson)
  if (!m) return null
  try {
    return JSON.parse(`"${m[1]}"`) as string
  } catch {
    return null
  }
}

/**
 * One turn of the conversation. `context` is the app's snapshot (lists and near shifts), as JSON.
 * `onEarly` gets the spoken part of the answer as soon as it is written, before the whole answer.
 */
// The app can be shown in other languages (src/i18n/languages.ts); then the assistant speaks that
// language. Only these names are accepted, so the field cannot carry other instructions.
const REPLY_LANGUAGES = ['English', 'Arabic', 'Russian', 'Spanish', 'French', 'German', 'Portuguese', 'Simplified Chinese', 'Hindi', 'Bengali', 'Urdu', 'Indonesian', 'Japanese', 'Turkish']
export function languageNote(context: unknown): { type: 'text'; text: string }[] {
  const lang = (context as { replyLanguage?: unknown }).replyLanguage
  if (typeof lang !== 'string' || !REPLY_LANGUAGES.includes(lang)) return []
  return [
    {
      type: 'text',
      text: `The manager uses the app in ${lang}. Everything you say to him (every spoken answer, question, summary and option, and any text in a tool call that he hears or reads) must be in natural, everyday ${lang}, not in Hebrew. He also speaks to you in ${lang}. The app's data, lists and the instructions above are in Hebrew: keep the names of workers, places and list items as they are written, and translate everything else.`,
    },
  ]
}

export async function runAssistant(
  apiKey: string,
  messages: unknown,
  context: unknown,
  model: string = ASSISTANT_MODEL,
  onEarly?: (text: string) => void,
  manualLocal = false,
): Promise<AssistantReply> {
  if (!validConversation(messages) || !context || typeof context !== 'object') return { ok: false, reason: 'bad-body' }
  // Paid calls only from Vercel: on this machine nothing is sent, whatever key is given (spendGuard.ts),
  // except the owner's own manual test in the dev server with the switch on (vite.config.ts).
  if (!onVercel() && !manualLocal) return { ok: false, reason: 'no-key' }
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 40_000 })
  let res: Anthropic.Message
  try {
    const stream = client.messages.stream({
      model: pickModel(model),
      max_tokens: 6000,
      // The fixed instructions and tools first (cached); the mode and the day's data after them.
      system: [
        { type: 'text', text: SYSTEM },
        { type: 'text', text: MODE, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `הנתונים של האפליקציה עכשיו:\n${JSON.stringify(context)}` },
        ...languageNote(context),
      ],
      tools: TOOLS,
      tool_choice: { type: 'auto' },
      // Low: the hard thinking is the planner's (solve), the model recognizes and words (docs/spikes/solver.md).
      output_config: { effort: 'low' },
      messages,
    })
    let tool = ''
    let partial = ''
    let sent = false
    for await (const ev of stream) {
      if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
        tool = ev.content_block.name
        partial = ''
      } else if (ev.type === 'content_block_delta' && ev.delta.type === 'input_json_delta' && !sent && onEarly) {
        partial += ev.delta.partial_json
        const early = earlyText(tool, partial)
        if (early) {
          sent = true
          onEarly(early)
        }
      }
    }
    res = await stream.finalMessage()
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, reason: 'no-key' }
    // The account ran out of credit or hit its spend limit: say so, not "try again".
    if (e instanceof Anthropic.APIError && /credit balance|spend limit|usage limit|billing/i.test(e.message)) return { ok: false, reason: 'no-credit' }
    console.error('assistant error', (e as Error).name, (e as Error).message?.slice(0, 300))
    return { ok: false, reason: 'failed' }
  }
  if (res.stop_reason === 'refusal') return { ok: false, reason: 'refused' }
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(' ').trim()
  return { ok: true, content: res.content, call: use ? { id: use.id, name: use.name, input: use.input } : null, text, usage: res.usage }
}

/**
 * The turn as a stream of JSON lines: `{"early": "..."}` as soon as the spoken part is written, then
 * `{"reply": ...}` (or `{"reason": ...}` on failure). The connection stays open while it thinks.
 */
export function assistantStream(
  apiKey: string,
  messages: unknown,
  context: unknown,
  model?: string,
  manualLocal = false,
  // Runs once the answer is in (the server counts its cost here); what it returns goes on the last line.
  after?: (reply: AssistantReply) => Promise<Record<string, unknown>>,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      const line = (v: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(v)}\n`))
      const reply = await runAssistant(apiKey, messages, context, model, (early) => line({ early }), manualLocal)
      const extra = after ? await after(reply).catch(() => ({})) : {}
      line(reply.ok ? { reply, ...extra } : { reason: reply.reason, ...extra })
      controller.close()
    },
  })
}
