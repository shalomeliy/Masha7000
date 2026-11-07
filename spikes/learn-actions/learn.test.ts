// Spike measurement. Run: npx vitest run spikes/learn-actions --dir .
import { describe, expect, it } from 'vitest'
import { handle, learn, type Example, type Lists, type Outcome } from './learn'

const NOW = new Date('2026-11-07T10:00:00') // Saturday: ראשון = 11-08, שני = 11-09, שלישי = 11-10
const lists: Lists = {
  roles: [{ id: 'r1', name: 'טפסן' }, { id: 'r2', name: 'חשמלאי' }, { id: 'r3', name: 'טכנאי אנטנות' }, { id: 'r4', name: 'טכנאי מצלמות' }],
  workers: [{ id: 'w1', firstName: 'דני', lastName: 'לוי' }, { id: 'w2', firstName: 'יוסי', lastName: 'כהן' }],
  shiftDefinitions: [{ id: 's1', name: 'יום' }, { id: 's2', name: 'לילה' }, { id: 'np', name: 'לינה', thenJob: true }],
  places: [{ id: 'p1', name: 'אילת אתר 123' }, { id: 'p2', name: 'דימונה 556' }, { id: 'p3', name: 'ערד 17' }, { id: 'p4', name: 'מצפה רמון' }],
  jobTypes: [{ id: 'j1', name: 'החלפת אנטנה' }, { id: 'j2', name: 'תחזוקת מצלמות' }],
}

// What Claude did in past conversations, as the manager confirmed it (corrections included in `said`).
const EXAMPLES: Example[] = [
  {
    said: 'תפתח עבודה ראשון הקרוב כולל לינה באילת אתר 123 החלפת אנטנה שני מטפסים',
    job: { date: '2026-11-08', shiftKindId: 'np', location: 'אילת אתר 123', jobDescription: 'החלפת אנטנה', staffing: [{ roleId: 'r1', count: 2 }], autoAssign: false },
  },
  {
    said: 'תפתח עבודה מחר עבודת יום בדימונה 556 תחזוקת מצלמות טכנאי מצלמות אחד ותשבץ לי מישהו',
    job: { date: '2026-11-08', shiftKindId: 's1', location: 'דימונה 556', jobDescription: 'תחזוקת מצלמות', staffing: [{ roleId: 'r4', count: 1 }], autoAssign: true },
  },
]

const job = (date: string, kind: string, location: string, desc: string, staffing: [string, number][], autoAssign = false): Outcome => ({
  kind: 'job',
  job: { date, shiftKindId: kind, location, jobDescription: desc, staffing: staffing.map(([roleId, count]) => ({ roleId, count })), autoAssign },
})

// New requests with other details and other word order. Expected: done alone, or a question.
const NEW: [string, Outcome | 'ask'][] = [
  ['תפתח עבודה ביום שלישי לילה בערד 17 החלפת אנטנה שלושה מטפסים', job('2026-11-10', 's2', 'ערד 17', 'החלפת אנטנה', [['r1', 3]])],
  ['תפתח עבודה מחר עבודת יום במצפה רמון תחזוקת מצלמות טכנאי מצלמות אחד', job('2026-11-08', 's1', 'מצפה רמון', 'תחזוקת מצלמות', [['r4', 1]])],
  ['תפתח עבודה בשני כולל לינה בדימונה 556 החלפת אנטנה שני מטפסים וחשמלאי ותשבץ', job('2026-11-09', 'np', 'דימונה 556', 'החלפת אנטנה', [['r1', 2], ['r2', 1]], true)],
  ['תפתח עבודה מחרתיים יום באילת אתר 123 החלפת אנטנה טפסן אחד', job('2026-11-09', 's1', 'אילת אתר 123', 'החלפת אנטנה', [['r1', 1]])],
  ['תפתח עבודה ראשון הקרוב לילה בערד 17 החלפת כבלים שני חשמלאים', job('2026-11-08', 's2', 'ערד 17', 'החלפת כבלים', [['r2', 2]])],
  ['תפתח עבודה מחר באילת אתר 123 החלפת אנטנה', 'ask'], // no kind, no people: ask
  ['תפתח עבודה לילה בדימונה 556 תחזוקת מצלמות טכנאי מצלמות אחד', 'ask'], // no date
  ['עבודה חדשה מחר לילה בערד 17 החלפת אנטנה שני מטפסים ותשבץ לי מישהו', job('2026-11-08', 's2', 'ערד 17', 'החלפת אנטנה', [['r1', 2]], true)],
]

// Not a new job, or beyond what was learned: must go to Claude.
const OTHER = [
  'דני חולה, הוא לא יכול לצאת ביום ראשון לאילת. מה עושים?',
  'תזכור שאבי לא עושה לילות בכלל',
  'מי בדרך כלל עובד באילת?',
  'תעביר את העבודה של מחר בדימונה 556 ליום שלישי',
  'תסגור את העבודה באילת אתר 123, הסתיימה',
  'תפתח עבודה מחר לילה באילת אתר 123 החלפת אנטנה עם דני ויוסי',
  'תמחק את העבודה של מחר בערד 17',
  'כמה מטפסים יש לי מחר',
]

describe('learn actions spike', () => {
  const learned = learn(EXAMPLES, lists, NOW)

  it('reports', () => {
    console.log('learned:', JSON.stringify(learned))
    let ok = 0
    for (const [s, want] of NEW) {
      const got = handle(s, learned, lists, NOW)
      const good = want === 'ask' ? got.kind === 'ask' : JSON.stringify(got) === JSON.stringify(want)
      if (good) ok++
      console.log(`${good ? 'OK   ' : 'MISS '} ${s}\n      -> ${JSON.stringify(got)}`)
    }
    console.log(`new jobs right: ${ok}/${NEW.length}`)
    let safe = 0
    for (const s of OTHER) {
      const got = handle(s, learned, lists, NOW)
      if (got.kind === 'claude') safe++
      else console.log(`WRONG ${s}\n      -> ${JSON.stringify(got)}`)
    }
    console.log(`other sent to Claude: ${safe}/${OTHER.length}`)
  })

  it('learned the alias "מטפס" = טפסן from Claude', () => expect(learned.aliases['מטפס']).toBe('r1'))
  it('never acts alone on something else', () => expect(OTHER.filter((s) => handle(s, learned, lists, NOW).kind !== 'claude')).toEqual([]))

  it('a new way of saying it goes to Claude once, then is learned', () => {
    const said = 'עבודה חדשה מחר לילה בערד 17 החלפת אנטנה שני מטפסים ותשבץ לי מישהו'
    expect(handle(said, learned, lists, NOW).kind).toBe('claude')
    const after = learn([...EXAMPLES, { said, job: { date: '2026-11-08', shiftKindId: 's2', location: 'ערד 17', jobDescription: 'החלפת אנטנה', staffing: [{ roleId: 'r1', count: 2 }], autoAssign: true } }], lists, NOW)
    expect(handle('עבודה חדשה בשלישי יום במצפה רמון תחזוקת מצלמות חשמלאי אחד', after, lists, NOW)).toEqual(
      job('2026-11-10', 's1', 'מצפה רמון', 'תחזוקת מצלמות', [['r2', 1]]),
    )
  })
})
