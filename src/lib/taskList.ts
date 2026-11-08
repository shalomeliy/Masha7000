// A job's description said or typed as several tasks ("החלפת נורה וניקוי עדשה") is saved as a numbered
// list, one task a line (the user's request, 2026-11-08). Free and local: no Claude. The manager's own
// words are kept as said; only the split, the numbers and a joining "ו" / "וגם" change.

// Words that start a task: the action nouns of field work, and their "to do" forms.
const TASK_NOUNS = [
  'החלפת', 'החלפה', 'תיקון', 'תיקוני', 'ניקוי', 'התקנת', 'התקנה', 'בדיקת', 'בדיקה', 'בדיקות', 'פירוק', 'הרכבת', 'הרכבה',
  'צביעת', 'צביעה', 'ריתוך', 'טיפול', 'שיפוץ', 'הזזת', 'העברת', 'חיבור', 'ניתוק', 'פינוי', 'איסוף', 'הובלת', 'הובלה',
  'סידור', 'סימון', 'גיזום', 'כיול', 'הדבקת', 'אטימת', 'איטום', 'קידוח', 'חיתוך', 'הורדת', 'הוספת', 'הסרת', 'הנחת',
  'שטיפת', 'שטיפה', 'ריסוס', 'החזרת', 'מדידת', 'מדידה', 'תחזוקת', 'תחזוקה', 'בניית', 'הקמת', 'פריסת', 'מתיחת', 'השחלת',
  'ביצוע', 'שינוע', 'ריצוף', 'טיוח', 'חפירת', 'חפירה', 'יציקת', 'יציקה', 'שיקום', 'עדכון', 'הגדרת', 'הפעלת', 'כיבוי',
  'סגירת', 'פתיחת', 'צילום', 'סקר', 'ביקורת', 'החלקת', 'גירוד', 'ליטוש', 'משיכת', 'הנחה',
]
const TASK_VERBS = [
  'להחליף', 'לתקן', 'לנקות', 'להתקין', 'לבדוק', 'לפרק', 'להרכיב', 'לצבוע', 'לרתך', 'לטפל', 'לשפץ', 'להזיז', 'להעביר',
  'לחבר', 'לנתק', 'לפנות', 'לאסוף', 'להוביל', 'לסדר', 'לסמן', 'לגזום', 'לכייל', 'להדביק', 'לאטום', 'לקדוח', 'לחתוך',
  'להוריד', 'להוסיף', 'להסיר', 'להניח', 'לשטוף', 'לרסס', 'להחזיר', 'למדוד', 'לבנות', 'להקים', 'לפרוס', 'למתוח', 'להשחיל',
  'לבצע', 'לשנע', 'לרצף', 'לחפור', 'לצקת', 'לשקם', 'לעדכן', 'להגדיר', 'להפעיל', 'לכבות', 'לסגור', 'לפתוח', 'לצלם',
]
const TASK_WORDS = new Set([...TASK_NOUNS, ...TASK_VERBS])
// Said between two tasks: "ואז", "ואחר כך", "בנוסף", "וגם".
const JOINERS = /\s+(?:ו?אחר\s+כך|ו?אחרי\s+זה|ואחרי\s+כן|ואז|בנוסף|ובנוסף|וגם)\s+/g
// A line that is already numbered or bulleted: "1.", "2)", "-", "•".
const MARK = /^\s*(?:\d{1,2}\s*[.)\-:]|[-•*])\s*/

const isTask = (w: string) => TASK_WORDS.has(w.replace(/^ו/, '')) || TASK_WORDS.has(w)
const tidy = (s: string) => s.replace(/^\s*(?:ו?גם|ו)\s+/, '').replace(/[\s.,;]+$/, '').trim()

/** Splits one stretch of words before each task word joined with "ו" ("וניקוי") or said right after another task. */
function byTaskWords(part: string): string[] {
  const ws = part.split(/\s+/).filter(Boolean)
  const out: string[][] = []
  const startsTask = isTask(ws[0] ?? '')
  for (const w of ws) {
    const cur = out[out.length - 1]
    // A new task starts at a task word that is not the first word, and only when the words before it are
    // more than the bare task word ("ניקוי ושטיפה של עדשות" stays one task).
    const split = cur && cur.length > 1 && isTask(w) && (w.startsWith('ו') ? TASK_WORDS.has(w.slice(1)) : startsTask)
    if (!cur || split) out.push([w.startsWith('ו') && TASK_WORDS.has(w.slice(1)) ? w.slice(1) : w])
    else cur.push(w)
  }
  return out.map((p) => p.join(' '))
}

/** The tasks in a job's description, in the order said. One task (or none) when it cannot be split. */
export function splitTasks(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(MARK, ''))
    .filter((l) => l.trim())
  const parts = lines
    .flatMap((l) => l.replace(JOINERS, ' \n ').split('\n'))
    .flatMap((l) => {
      // A comma or a full stop parts tasks only before a task word: "מבנה A, קומה 2" stays one.
      const bits = l.split(/[,;]|\.(?!\d)|\s-\s/).map(tidy).filter(Boolean)
      const out: string[] = []
      for (const b of bits) {
        if (out.length && !isTask(b.split(/\s+/)[0])) out[out.length - 1] += `, ${b}`
        else out.push(b)
      }
      return out
    })
    .map(tidy)
    .filter(Boolean)
  return parts.flatMap(byTaskWords).map(tidy).filter(Boolean)
}

/** The description as saved: a numbered list when it holds more than one task, else as written. */
export function asTaskList(text: string): string {
  const tasks = splitTasks(text)
  return tasks.length > 1 ? tasks.map((t, i) => `${i + 1}. ${t}`).join('\n') : text.trim()
}

/** The description on one line, for a title or a sentence: "החלפת נורה, ניקוי עדשה". */
export const oneLine = (text: string) => {
  const tasks = splitTasks(text)
  return tasks.length > 1 ? tasks.join(', ') : text.trim()
}
