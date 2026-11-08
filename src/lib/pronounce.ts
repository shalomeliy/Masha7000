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
  // Two-word entries first ("באר שבע"), as a whole, only between non-letters.
  let out = text
  for (const { word, say } of entries)
    if (word.includes(' ')) out = out.replace(new RegExp(`(^|[^א-ת])([ובכלמשה]{0,3})${escape(word)}(?![א-ת])`, 'g'), (_, before: string, front: string) => before + withFront(front, say))
  return out.replace(HEBREW_WORD, (token) => {
    for (const { word, say } of entries) {
      if (token === word) return say
      if (token.length > word.length && token.endsWith(word)) {
        const front = token.slice(0, token.length - word.length)
        if (PREFIX.test(front)) return withFront(front, say)
      }
    }
    return token
  })
}

// The letters in front of a word, then how the word is said. Glued when the word stays in Hebrew letters;
// "ולטפסן" -> "ve le Tapsan" in English ones ("ה" after ב/ל/כ is not said: "latapsan"; close enough).
function withFront(front: string, say: string): string {
  if (!front) return say
  if (!LATIN.test(say)) return front + say
  return [...front].map((c) => SAID[c]).join(' ') + ' ' + say
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The Hebrew words of a text, as said ("בקניון", not "קניון"). */
export const hebrewWords = (text: string): string[] => (text.match(HEBREW_WORD) ?? []).map((w) => w.replace(/^["'׳״]+|["'׳״]+$/g, '')).filter((w) => w.length > 1)

/** Is this word, or the same word without ו/ב/ל/ה... in front, one of `known`? */
export function isKnownWord(token: string, known: ReadonlySet<string>): boolean {
  if (known.has(token)) return true
  for (let i = 1; i <= 3 && token.length - i >= 2; i++) if (PREFIX.test(token.slice(0, i)) && known.has(token.slice(i))) return true
  return false
}

/** Words in a spoken text that are not known yet, each once, in the order said. */
export function unknownWords(text: string, known: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const w of hebrewWords(text)) if (!isKnownWord(w, known) && !out.includes(w)) out.push(w)
  return out
}

/**
 * What is left to listen to in "אימון הגייה": words said by the assistant and not heard yet (oldest
 * first), then the starting list, without the words already approved or fixed.
 */
export function reviewQueue(seed: readonly string[], heard: readonly { word: string }[], done: ReadonlySet<string>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const w of [...heard.map((n) => n.word), ...seed])
    if (!done.has(w) && !seen.has(w)) {
      seen.add(w)
      out.push(w)
    }
  return out
}

/** Checks a new entry before it is saved; null when fine. */
export function pronunciationError(word: string, say: string): string | null {
  if (!word.trim()) return 'word'
  if (!say.trim()) return 'say'
  if (word.trim() === say.trim()) return 'same'
  return null
}
