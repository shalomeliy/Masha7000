import type { Pronunciation } from '../types/models'

// How the assistant says words the phone's voice gets wrong. Niqqud did not help on the owner's phone
// (2026-11-08 test); writing the word another way did, sometimes only in English letters. So each
// entry is the word as written and how to write it for the voice.

/** Words the app knows are said wrong, before the manager adds any. His own entry for a word wins. */
export const BUILT_IN: readonly Omit<Pronunciation, 'id'>[] = [
  { word: 'טפסן', say: 'Tapsan' },
  { word: 'טפסנים', say: 'Tapsanim' },
  { word: 'טפסנית', say: 'Tapsanit' },
]

let table: Omit<Pronunciation, 'id'>[] = [...BUILT_IN]

/** The manager's entries first, then the built-in ones he did not replace. Safe to call again. */
export function applyPronunciations(mine: readonly Pronunciation[]) {
  const own = mine.filter((p) => p.word.trim() && p.say.trim()).map((p) => ({ word: p.word.trim(), say: p.say.trim() }))
  table = [...own, ...BUILT_IN.filter((b) => !own.some((o) => o.word === b.word))]
}

/** Every word in use, the manager's and the built-in ones, for the settings screen. */
export const pronunciationTable = () => table

// Letters that stick to the front of a Hebrew word: "ו", "ב", "ל", "ה"... ("ולטפסן", "הטפסן").
const PREFIX = /^[ובכלמשה]{1,3}$/
// The same letters said, for when the word is replaced by English letters, which a Hebrew letter
// glued to would be spelled out.
const SAID: Record<string, string> = { ו: 've', ב: 'be', כ: 'ke', ל: 'le', מ: 'mi', ש: 'she', ה: 'ha' }
const LATIN = /[a-z]/i
const HEBREW_WORD = /[א-ת֑-ׇ"'׳״]+/g

/** The text with every known word (also with ו/ב/ל/ה... in front) written the way the voice says it right. */
export function pronounce(text: string, entries: readonly Omit<Pronunciation, 'id'>[] = table): string {
  if (!entries.length) return text
  return text.replace(HEBREW_WORD, (token) => {
    for (const { word, say } of entries) {
      if (token === word) return say
      if (token.length > word.length && token.endsWith(word)) {
        const front = token.slice(0, token.length - word.length)
        if (!PREFIX.test(front)) continue
        if (!LATIN.test(say)) return front + say
        // "ולטפסן" -> "ve le Tapsan"; "ה" after ב/ל/כ is not said ("לטפסן" is "latapsan"), close enough.
        return [...front].map((c) => SAID[c]).join(' ') + ' ' + say
      }
    }
    return token
  })
}

/** Checks a new entry before it is saved; null when fine. */
export function pronunciationError(word: string, say: string): string | null {
  if (!word.trim()) return 'word'
  if (!say.trim()) return 'say'
  if (word.trim() === say.trim()) return 'same'
  return null
}
