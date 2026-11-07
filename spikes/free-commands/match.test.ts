// Spike measurement: how many simple commands are caught for free, and whether anything that needs
// Claude is wrongly caught. Run: npx vitest run spikes/free-commands --dir .
import { describe, expect, it } from 'vitest'
import { matchLocal, whoWorks, type Local } from './match'

const NOW = new Date('2026-11-07T10:00:00') // Saturday
const T = (screen: string) => ({ kind: 'open', screen })
const P = (button: string) => ({ kind: 'press', button })
const W = (date: string) => ({ kind: 'who', date })

// Should be handled for free.
const SIMPLE: [string, Local][] = [
  ['תפתח את היומן', T('calendar') as Local],
  ['תפתח לי את היומן', T('calendar') as Local],
  ['יומן', T('calendar') as Local],
  ['תראה לי את היומן בבקשה', T('calendar') as Local],
  ['לך ליומן', T('calendar') as Local],
  ['תפתח את העובדים', T('workers') as Local],
  ['תראה לי את רשימת העובדים', T('workers') as Local],
  ['תפתח את ההגדרות', T('settings') as Local],
  ['תפתח לשיבוץ', T('toSchedule') as Local],
  ['תראה לי את העבודות לשיבוץ', T('toSchedule') as Local],
  ['תפתח את הארכיון', T('archive') as Local],
  ['תשלח את הסידור לעובדים', P('shareWeek') as Local],
  ['תשתף את השבוע בווטסאפ', P('shareWeek') as Local],
  ['תפתח עבודה דחופה', P('urgentNow') as Local],
  ['יש לי עבודה דחופה', P('urgentNow') as Local],
  ['תפתח עבודה חדשה', P('newJob') as Local],
  ['תוסיף עבודה', P('newJob') as Local],
  ['תבקש אילוצים מהעובדים', P('requestConstraints') as Local],
  ['תשלח את הקישור להצטרפות', P('joinLink') as Local],
  ['מי עובד מחר?', W('2026-11-08') as Local],
  ['מי עובד היום', W('2026-11-07') as Local],
  ['מי עובד ביום שלישי', W('2026-11-10') as Local],
  ['מה יש מחר', W('2026-11-08') as Local],
  ['אילו עבודות יש בראשון הקרוב', W('2026-11-08') as Local],
  ['מי יוצא מחרתיים', W('2026-11-09') as Local],
]

// Must go to Claude: details, names, places, problems, two requests, questions the rules do not know.
const HARD = [
  'תפתח עבודה ראשון הקרוב כולל לינה באילת אתר 123 החלפת אנטנה שני מטפסים',
  'מחר עבודת יום בדימונה 556 תחזוקת מצלמות טכנאי מצלמות אחד ותשבץ לי מישהו',
  'מי בדרך כלל עובד באילת?',
  'תזכור שאבי לא עושה לילות בכלל',
  'אני צריך את משה ולינה ביום שלישי',
  'דני חולה, הוא לא יכול לצאת ביום ראשון לאילת. מה עושים?',
  'ביום שלישי יש לי שתי עבודות לילה, במצפה רמון ובערד, ואין לי מספיק טפסנים. תציע לי פתרונות',
  'אבי לא יכול ביום שני והוא החשמלאי היחיד',
  'תפתח עבודה חדשה מחר באילת',
  'מי עובד מחר באילת',
  'מי לא עובד מחר',
  'דני עובד מחר?',
  'תפתח את היומן ותשבץ את דני',
  'תשבץ את דני ביום ראשון',
  'מה הכללים?',
  'כמה לילות עשה יוסי החודש',
  'תוסיף עובד חדש בשם רון כהן',
  'תעביר את העבודה של מחר לשלישי',
  'תשלח לדני את הסידור',
  'מי עובד בלילה בשבוע הבא',
  'תפתח את העבודה בדימונה',
  'למה דני לא משובץ',
]

// Written after the rules, not tuned on: natural variations, to estimate real coverage honestly.
const HOLDOUT: string[] = [
  'אפשר לראות את היומן',
  'תעביר אותי ליומן',
  'פתח יומן',
  'תפתחי את היומן',
  'תראה לי מה יש מחר',
  'מי משובץ מחר',
  'מי עובד ביום ראשון',
  'מה יש לנו מחר',
  'מי עובד בשבוע הבא',
  'מה קורה מחר',
  'תשלח לצוות את הסידור של השבוע',
  'שלח סידור',
  'תפתח קריאה דחופה',
  'עבודה דחופה',
  'אני רוצה לפתוח עבודה חדשה',
  'תבקש מהעובדים אילוצים לשבוע הבא',
  'תן לי את הלינק להצטרפות',
  'תראה לי את העובדים',
  'רשימת עובדים',
  'מה בהגדרות',
]

describe('free commands spike', () => {
  it('holdout coverage', () => {
    const hit = HOLDOUT.filter((s) => matchLocal(s, NOW) !== null)
    console.log(`holdout caught: ${hit.length}/${HOLDOUT.length}`)
    for (const s of HOLDOUT) console.log(`  ${matchLocal(s, NOW) ? 'free  ' : 'Claude'} ${s} ${JSON.stringify(matchLocal(s, NOW) ?? '')}`)
  })

  const caught = SIMPLE.filter(([s, want]) => JSON.stringify(matchLocal(s, NOW)) === JSON.stringify(want))
  const missed = SIMPLE.filter(([s, want]) => JSON.stringify(matchLocal(s, NOW)) !== JSON.stringify(want))
  const wrong = HARD.filter((s) => matchLocal(s, NOW) !== null)

  it('reports', () => {
    console.log(`simple caught: ${caught.length}/${SIMPLE.length}`)
    for (const [s] of missed) console.log(`  missed: ${s} -> ${JSON.stringify(matchLocal(s, NOW))}`)
    console.log(`hard wrongly caught: ${wrong.length}/${HARD.length}`)
    for (const s of wrong) console.log(`  WRONG: ${s} -> ${JSON.stringify(matchLocal(s, NOW))}`)
  })

  it('never acts on a sentence that needs Claude', () => expect(wrong).toEqual([]))
  it('catches every simple command in the list', () => expect(missed.map(([s]) => s)).toEqual([]))

  it('answers who works from the data', () => {
    const text = whoWorks(
      '2026-11-08',
      [{ date: '2026-11-08', location: 'אילת', jobDescription: 'אנטנה', shiftDefinitionId: 'd', crew: [{ workerId: 'w1' }, { workerId: 'w2' }] }],
      [{ id: 'w1', firstName: 'דני', lastName: 'לוי' }, { id: 'w2', firstName: 'אבי', lastName: 'כהן' }],
      [{ id: 'd', name: 'יום' }],
    )
    expect(text).toBe('עבודה אחת. יום באילת: דני לוי, אבי כהן.')
  })
})
