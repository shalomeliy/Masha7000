// Spike: can Shali recognize simple, common voice commands by itself (free, instant) and send only the
// rest to Claude (paid)? Throwaway. The rule: a sentence is handled here only when ALL of it matches a
// known command; anything extra (a name, a place, a problem, a second request) goes to Claude, because
// a wrong action is worse than a cent.

export type Screen = 'calendar' | 'toSchedule' | 'workers' | 'archive' | 'settings'
export type Button = 'shareWeek' | 'urgentNow' | 'newJob' | 'requestConstraints' | 'joinLink'
export type Local = { kind: 'open'; screen: Screen } | { kind: 'press'; button: Button } | { kind: 'who'; date: string } | null

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const plus = (now: Date, n: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n))

/** "היום", "מחר", "ביום שלישי", "בשלישי הקרוב", "בשבת": the date, or null if not exactly a day word. */
function dayWord(s: string, now: Date): string | null {
  if (/^(ה)?היום$/.test(s) || s === 'היום') return plus(now, 0)
  if (s === 'מחר') return plus(now, 1)
  if (s === 'מחרתיים') return plus(now, 2)
  const m = /^(?:ב|ל)?(?:יום )?(?:ה)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)(?: הקרוב| הזה| הבא)?$/.exec(s)
  if (!m) return null
  const want = DAYS.indexOf(m[1])
  const ahead = (want - now.getDay() + 7) % 7 || 7 // the coming one, never today
  return plus(now, ahead)
}

/** Lower noise: punctuation, polite fillers, "לי", "את ה". */
function clean(said: string): string {
  return said
    .replace(/[?!.,״"׳']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(שאלי|שלי|היי|הי|שלום|טוב|אוקיי|אוקי|יאללה)\s+/, '')
    .replace(/\s+(בבקשה|תודה|רגע|עכשיו)$/, '')
    .replace(/^(בבקשה|אפשר|תוכלי|תוכל)\s+/, '')
}

const SCREENS: [RegExp, Screen][] = [
  [/^(?:ה)?(?:יומן|לוח|לוח העבודות|לוח זמנים)$/, 'calendar'],
  [/^(?:ה)?(?:שיבוץ|לשיבוץ|עבודות לשיבוץ|עבודות שמחכות|רשימת ההמתנה)$/, 'toSchedule'],
  [/^(?:ה)?(?:עובדים|רשימת העובדים|צוות)$/, 'workers'],
  [/^(?:ה)?(?:ארכיון|היסטוריה|דוחות)$/, 'archive'],
  [/^(?:ה)?(?:הגדרות)$/, 'settings'],
]

const BUTTONS: [RegExp, Button][] = [
  [/^(?:תשלח|תשתף|שלח|שתף|תפיץ)(?: לי)? (?:את )?(?:ה)?(?:שבוע|סידור|סידור השבועי|סידור של השבוע|לוח של השבוע)(?: בווטסאפ| לצוות| לעובדים| לקבוצה)?$/, 'shareWeek'],
  [/^(?:תפתח|פתח|יש לי|צריך|תוסיף)(?: לי)? (?:עבודה )?(?:דחופה|קריאה דחופה|עבודה דחופה)(?: עכשיו)?$/, 'urgentNow'],
  [/^(?:תפתח|פתח|תוסיף|הוסף|ניצור|תיצור)(?: לי)? עבודה(?: חדשה)?$/, 'newJob'],
  [/^(?:תבקש|בקש|תשלח|שלח)(?: מה(?:עובדים|צוות))? (?:את )?(?:ה)?אילוצים(?: מה(?:עובדים|צוות))?$/, 'requestConstraints'],
  [/^(?:תשלח|שלח|תן לי|תביא לי|תיצור|צור)(?: לי)? (?:את )?(?:ה)?(?:קישור|לינק) (?:ה)?(?:הצטרפות|להצטרפות|לעובד חדש)$/, 'joinLink'],
]

export function matchLocal(said: string, now = new Date()): Local {
  const s = clean(said)
  if (!s || s.split(' ').length > 9) return null

  // Open a screen: "(תפתח|תראה|לך ל|תעבור ל|פתח) (לי) (את) X", or X alone.
  const open = /^(?:(?:תפתח|פתח|תראה|הראה|תציג|לך|תעבור|עבור|תכניס|קח)(?: לי(?= |$)| אותי)?(?: את| ל| אל| למסך| למסך של)? ?)?(.+)$/.exec(s)
  if (open) {
    const target = open[1].replace(/^(?:מסך |מסך ה|את )/, '').replace(/^ל(?=יומן|עובדים|הגדרות|ארכיון)/, '')
    for (const [re, screen] of SCREENS) if (re.test(target)) return { kind: 'open', screen }
  }

  for (const [re, button] of BUTTONS) if (re.test(s)) return { kind: 'press', button }

  // Who works on a day: "מי עובד מחר", "מי עובד ביום שלישי", "מה יש מחר", "אילו עבודות יש היום".
  const who = /^(?:מי (?:עובד|עובדים|יוצא|יוצאים|בעבודה|משובץ|משובצים)|מה יש|איזה עבודות יש|אילו עבודות יש|מה העבודות|מה הסידור|מה מתוכנן|יש עבודות) (.+)$/.exec(s)
  if (who) {
    const date = dayWord(who[1], now)
    if (date) return { kind: 'who', date }
  }
  return null
}

// The spoken answer to "who works", from the app's data, with no model.
interface Shift { date: string; location: string; jobDescription: string; crew: { workerId: string }[]; shiftDefinitionId?: string }
export function whoWorks(date: string, shifts: Shift[], workers: { id: string; firstName: string; lastName: string }[], defs: { id: string; name: string }[]): string {
  const day = shifts.filter((s) => s.date === date)
  if (day.length === 0) return 'אין עבודות ביום הזה.'
  const name = (id: string) => {
    const w = workers.find((x) => x.id === id)
    return w ? `${w.firstName} ${w.lastName}`.trim() : 'עובד לא ידוע'
  }
  const parts = day.map((s) => {
    const kind = defs.find((d) => d.id === s.shiftDefinitionId)?.name
    const crew = s.crew.length ? s.crew.map((c) => name(c.workerId)).join(', ') : 'עוד אין צוות'
    return `${kind ? `${kind} ` : ''}ב${s.location}: ${crew}`
  })
  return `${day.length === 1 ? 'עבודה אחת' : `${day.length} עבודות`}. ${parts.join('. ')}.`
}
