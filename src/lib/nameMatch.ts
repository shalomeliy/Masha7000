// How close a name heard by voice is to a name on a worker's card (the user's request, 2026-11-07:
// typos, speech-recognition errors and spelling variants, in Hebrew and English, should still find the
// worker; nothing close enough means no such worker, never a wild guess).
//
// Both names are brought to Hebrew letters (an English name is spelled the way it sounds: "Yossi" ->
// "יוסי"), then compared letter by letter. Changes that speech recognition and spelling make all the
// time cost half: a vowel letter added or dropped (א ה ו י ע), or one letter for another that sounds
// the same (כ/ק/ח, ת/ט, ס/ש, א/ע/ה, ב/ו). Any other change costs one.

const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' }
const WEAK = new Set(['א', 'ה', 'ו', 'י', 'ע'])
const ALIKE = [['כ', 'ק', 'ח'], ['ת', 'ט'], ['ס', 'ש'], ['א', 'ע', 'ה'], ['ב', 'ו']]

// English letters by sound. Pairs first ("sh" before "s").
const PAIRS: [string, string][] = [['sh', 'ש'], ['ch', 'ח'], ['kh', 'ח'], ['tz', 'צ'], ['ts', 'צ'], ['th', 'ת'], ['ph', 'פ'], ['zh', 'ז'], ['oo', 'ו'], ['ou', 'ו'], ['ee', 'י'], ['ai', 'י'], ['ay', 'י'], ['ei', 'י'], ['ey', 'י']]
const LETTERS: Record<string, string> = { b: 'ב', d: 'ד', f: 'פ', g: 'ג', h: 'ה', j: 'ג', k: 'ק', l: 'ל', m: 'מ', n: 'נ', p: 'פ', q: 'ק', r: 'ר', s: 'ס', t: 'ת', v: 'ו', w: 'ו', x: 'קס', z: 'ז', i: 'י', o: 'ו', u: 'ו', y: 'י' }

/** An English name in Hebrew letters, the way it is said: "Moshe" -> "מושה", "Dana" -> "דנה". */
export function latinToHebrew(s: string): string {
  const t = s.toLowerCase().replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1')
  let out = ''
  for (let i = 0; i < t.length; ) {
    const pair = PAIRS.find(([p]) => t.startsWith(p, i))
    if (pair) {
      out += pair[1]
      i += 2
      continue
    }
    const c = t[i]
    const first = i === 0
    const last = i === t.length - 1
    if (c === 'a' || c === 'e') out += first ? 'א' : last ? 'ה' : ''
    else if (c === 'c') out += /[eiy]/.test(t[i + 1] ?? '') ? 'ס' : 'ק'
    else out += (first && /[iou]/.test(c) ? 'א' : '') + (LETTERS[c] ?? '')
    i++
  }
  return out
}

/** One spelling for comparing: Hebrew letters only, no geresh or quotes, no final forms. */
export function nameForm(s: string): string {
  const t = /[a-z]/i.test(s) ? latinToHebrew(s) : s
  return t
    .replace(/[֑-ׇ]/g, '')
    .replace(/[^א-ת]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
}

const alike = (a: string, b: string) => ALIKE.some((g) => g.includes(a) && g.includes(b))

/** How far apart two names are: 0 = the same, 0.5 = a vowel letter or a sound-alike letter, 1 = any other letter. */
export function nameDistance(a: string, b: string): number {
  const x = nameForm(a)
  const y = nameForm(b)
  if (x === y) return 0
  let prev = [0]
  for (let j = 1; j <= y.length; j++) prev[j] = prev[j - 1] + (WEAK.has(y[j - 1]) ? 0.5 : 1)
  for (let i = 1; i <= x.length; i++) {
    const cur = [prev[0] + (WEAK.has(x[i - 1]) ? 0.5 : 1)]
    for (let j = 1; j <= y.length; j++) {
      const p = x[i - 1]
      const q = y[j - 1]
      const sub = p === q ? 0 : alike(p, q) ? 0.5 : 1
      cur[j] = Math.min(prev[j - 1] + sub, prev[j] + (WEAK.has(p) ? 0.5 : 1), cur[j - 1] + (WEAK.has(q) ? 0.5 : 1))
    }
    prev = cur
  }
  return prev[y.length]
}

/** How much a name may differ and still be it: short names must be almost exact. */
export function nameLimit(name: string): number {
  const n = nameForm(name).length
  if (n <= 2) return 0
  if (n === 3) return 0.5
  if (n <= 5) return 1
  if (n <= 8) return 1.5
  return 2
}

/** True when a heard word is close enough to a name on a card. */
export const closeName = (heard: string, name: string) => Boolean(name) && nameDistance(heard, name) <= nameLimit(name)
