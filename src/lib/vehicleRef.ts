// A vehicle said by voice (the user's request, 2026-11-15): the manager names a vehicle by the last 3
// digits of its licence plate ("רכב 678", "רכב שש שבע שמונה", "רכב שש מאות שבעים ושמונה", "ה-678"),
// maybe with its make or model ("רכב 345 דאצ'יה", "הדימקס 345"). The app finds the vehicle, checks
// that the make or model said fits it (when it does not, the manager is corrected: "רכב 345 הוא איסוזו
// דימקס, לא דאצ'יה"), and asks when two vehicles fit. Every read-back says the 3 digits, make and model.
// Pure, Hebrew only (the free path), and used by the read-back of Claude's proposals too.

import { closeName, nameDistance } from './nameMatch'
import { makeOf, modelOf, plateOf } from './vehicles'
import type { Vehicle } from '../types/models'

/** The digits of a plate: "12-345-67" -> "1234567". */
export const plateDigits = (v: Vehicle) => plateOf(v).replace(/\D/g, '')
/** The last 3 digits of the plate: how the manager names a vehicle. */
export const last3 = (v: Vehicle) => plateDigits(v).slice(-3)
/** "סיטרואן ברלינגו": the make, then the model. */
export const carName = (v: Vehicle) => [makeOf(v), modelOf(v)].filter(Boolean).join(' ')
/** "678, סיטרואן ברלינגו": how a vehicle is said back. */
export const carText = (v: Vehicle) => [last3(v) || plateOf(v), carName(v)].filter(Boolean).join(', ')

// ---- Numbers said in words ----

const UNITS: Record<string, number> = {
  אפס: 0, אחד: 1, אחת: 1, שתיים: 2, שתים: 2, שניים: 2, שני: 2, שתי: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5,
  שש: 6, שישה: 6, שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9,
}
const TENS: Record<string, number> = { עשרים: 20, שלושים: 30, ארבעים: 40, חמישים: 50, שישים: 60, שבעים: 70, שמונים: 80, תשעים: 90 }
const HUNDREDS: Record<string, number> = { מאה: 100, מאתיים: 200 }
const TEN = new Set(['עשר', 'עשרה'])

/** A number word without its ו ("וחמש" -> "חמש"), or null. */
function numberWord(w: string): string | null {
  const known = (x: string) => x in UNITS || x in TENS || x in HUNDREDS || TEN.has(x) || x === 'מאות'
  if (known(w)) return w
  return w.length > 2 && w.startsWith('ו') && known(w.slice(1)) ? w.slice(1) : null
}
// "345", "ה-345", "ב-345", "12-345-67", "3-4-5".
const DIGITS = /^(?:ו?[הבל]?-?)?(\d[\d-]*)$/

/**
 * The number said from word `i` on, as digits: "345", "3 4 5", "שלוש ארבע חמש" (digit by digit) or
 * "שלוש מאות ארבעים וחמש" (as one number). Null when no number starts there.
 */
export function numberAt(ws: string[], i: number): { digits: string; n: number } | null {
  // Digits: one token, or a few short ones in a row ("3 4 5", "12 345 67").
  if (DIGITS.test(ws[i] ?? '')) {
    let digits = ''
    let j = i
    while (j < ws.length && DIGITS.test(ws[j]) && digits.length < 8) {
      const d = DIGITS.exec(ws[j])![1].replace(/-/g, '')
      if (j > i && (d.length > 2 || digits.length >= 3)) break // "345 2" is not one number
      digits += d
      j++
    }
    return { digits, n: j - i }
  }
  const parts: string[] = []
  for (let j = i; j < ws.length && parts.length < 6; j++) {
    const w = numberWord(ws[j])
    if (!w) break
    parts.push(w)
  }
  if (!parts.length || parts[0] === 'מאות') return null
  const composed = parts.some((w) => w in TENS || w in HUNDREDS || TEN.has(w) || w === 'מאות')
  if (!composed) {
    // Digit by digit: at most 3 ("שלוש ארבע חמש"), so "רכב 3 4 5 שני מטפסים" keeps its count.
    const n = Math.min(parts.length, 3)
    return { digits: parts.slice(0, n).map((w) => String(UNITS[w])).join(''), n }
  }
  // One number: each part in a lower place than the one before (hundreds, tens, units).
  let total = 0
  let place = 4
  let k = 0
  for (; k < parts.length; k++) {
    const w = parts[k]
    const next = parts[k + 1]
    // [value, its place (3 hundreds, 2 tens, 1 units), words it takes]
    const part: [number, number, number] | null =
      w in UNITS && next === 'מאות' ? [UNITS[w] * 100, 3, 2]
      : w in UNITS && next && TEN.has(next) ? [10 + UNITS[w], 1, 2]
      : w in HUNDREDS ? [HUNDREDS[w], 3, 1]
      : TEN.has(w) ? [10, 1, 1]
      : w in TENS ? [TENS[w], 2, 1]
      : w in UNITS ? [UNITS[w], 1, 1]
      : null
    if (!part) break
    const [value, at, take] = part
    if (at >= place) break
    total += value
    place = at
    k += take - 1
  }
  return k ? { digits: String(total), n: k } : null
}

// ---- Makes and models, in Hebrew and English ----

// Common makes and models of work vehicles, as said in Hebrew and written on the card (often English).
// A word is matched by closeness too (src/lib/nameMatch.ts), so these are only the names whose
// English spelling does not sound like the Hebrew one.
const CAR_NAMES: string[][] = [
  ['Dacia', "דאצ'יה", 'דאציה', "דצ'יה", 'דציה'],
  ['Renault', 'רנו'],
  ['Peugeot', "פיג'ו", 'פיגו', "פיז'ו", 'פזו'],
  ['Chevrolet', 'שברולט', 'שברולה'],
  ['Volkswagen', 'פולקסווגן', 'פולקסוואגן', 'פולקס', 'VW'],
  ['Citroen', 'סיטרואן', 'סיטרואין'],
  ['Isuzu', 'איסוזו'],
  ['Toyota', 'טויוטה'],
  ['Ford', 'פורד'],
  ['Fiat', 'פיאט'],
  ['Opel', 'אופל'],
  ['Nissan', 'ניסאן', 'ניסן'],
  ['Mitsubishi', 'מיצובישי'],
  ['Hyundai', 'יונדאי', 'הונדאי'],
  ['Kia', 'קיה'],
  ['Mercedes', 'מרצדס'],
  ['Ram', 'ראם', 'רם'],
  ['Iveco', 'איווקו', 'איבקו'],
  ['Mazda', 'מאזדה', 'מזדה'],
  ['Suzuki', 'סוזוקי'],
  ['Skoda', 'סקודה'],
  ['Subaru', 'סובארו'],
  ['Honda', 'הונדה'],
  ['Jeep', "ג'יפ"],
  ['Volvo', 'וולוו'],
  ['Scania', 'סקניה'],
  ['Mahindra', 'מהינדרה'],
  ['Hummer', 'HMMWV', 'האמר', 'הממר', 'האמוי'],
  ['D-Max', 'DMax', 'דימקס', 'די מקס', 'דמקס'],
  ['Hilux', 'הילוקס'],
  ['Berlingo', 'ברלינגו'],
  ['Dokker', 'דוקר'],
  ['Duster', 'דאסטר', 'דסטר'],
  ['Kangoo', 'קנגו', 'קאנגו'],
  ['Caddy', 'קאדי', 'קדי'],
  ['Transit', 'טרנזיט'],
  ['Tourneo', 'טורנאו', 'טורניאו'],
  ['Partner', 'פרטנר'],
  ['Rifter', 'ריפטר'],
  ['Doblo', 'דובלו'],
  ['Combo', 'קומבו'],
  ['Ranger', "ריינג'ר", 'ריינגר'],
  ['Navara', 'נווארה', 'נברה'],
  ['Silverado', 'סילברדו', 'סילוורדו'],
  ['Hiace', 'הייאס', 'הייס'],
  ['Crafter', 'קרפטר'],
  ['Sprinter', 'ספרינטר'],
  ['Ducato', 'דוקאטו'],
  ['Master', 'מאסטר'],
  ['Jumper', "ג'אמפר"],
  ['Vito', 'ויטו'],
  ['Amarok', 'אמרוק'],
  ['Defender', 'דיפנדר'],
  ['Trafic', 'טראפיק', 'טרפיק'],
  ['Transporter', 'טרנספורטר'],
  ['Super Duty', 'סופר דיוטי'],
]
const strip = (w: string) => w.replace(/['׳"״`]/g, '')
/** A word without one leading ה/ו/ב/ל ("הדימקס" -> "דימקס"). */
const bare1 = (w: string) => w.replace(/^(?:ו?[הבל]|ו)(?=.{3,})/, '')

function nameGroup(w: string): number {
  const x = strip(w)
  return CAR_NAMES.findIndex((g) => g.some((s) => !s.includes(' ') && (strip(s) === x || closeName(x, strip(s)))))
}

/** The words of a vehicle's make and model: "Isuzu", "D-Max", "4X4". */
function carWords(v: Vehicle): string[] {
  return carName(v)
    .split(/[\s/]+/)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w))
}

/** True when the word said is the make or model of this vehicle (by sound, in Hebrew or English). */
export function fitsCar(said: string, v: Vehicle): boolean {
  const forms = [strip(said), strip(bare1(said))]
  return carWords(v).some((x) => {
    const g = nameGroup(x)
    return forms.some((f) => closeName(f, strip(x)) || (g >= 0 && nameGroup(f) === g))
  })
}

/** True when the text names this vehicle the way the read-back must: its last 3 digits, make and model. */
export function saysCar(text: string, v: Vehicle): boolean {
  const ws = text.replace(/[?!.,:;()]/g, ' ').split(/\s+/).filter(Boolean)
  if (last3(v) && !text.includes(last3(v))) return false
  // Model words with digits ("4X4", "NV200") may be left out when there are words without.
  const all = carWords(v)
  const need = all.some((x) => !/\d/.test(x)) ? all.filter((x) => !/\d/.test(x)) : all
  return need.every((x) => {
    const g = nameGroup(x)
    return ws.some((w) => [strip(w), strip(bare1(w))].some((f) => f.toLowerCase() === strip(x).toLowerCase() || closeName(f, strip(x)) || (g >= 0 && nameGroup(f) === g)))
  })
}

// Words that name a vehicle: "רכב 678", "את הרכב", "ברכב", "משאית", "טנדר".
export const CAR_WORD = /^(?:ו?(?:ה|ב|ל|את ה|עם ה)?)(?:רכב|משאית|טנדר|ואן|מסחרית|ג'יפ|ג׳יפ)$/
// Words between "רכב" and its number: "רכב מספר 678", "הרכב שמספרו נגמר ב-678".
const LINK = /^(?:מספר|מס|רישוי|הרישוי|לוחית|שמספרו|שמספר|שהמספר|שלו|שמסתיים|מסתיים|שנגמר|נגמר|שמספרה|שמסתיימת|ב)$/

export interface CarRef {
  at: number // where it starts in the sentence (words)
  n: number // how many words it took
  digits: string // the plate digits said ('' = none, only a make or model)
  said: string[] // the make and model words said
  ids: string[] // the vehicles it may be: one, none, or several (ask)
  wrong: string[] // make or model words said that do not fit the vehicle the digits name
}

/**
 * The vehicle named in the sentence, if any; its words are marked used. `stop` keeps the app's own
 * words (days, verbs, places) from being read as a make or model.
 */
export function readCar(ws: string[], used: boolean[], vehicles: Vehicle[], stop: (w: string) => boolean): CarRef | undefined {
  const isCarWord = (i: number) => {
    const w = ws[i]
    if (!w || used[i] || stop(w) || stop(bare1(w)) || CAR_WORD.test(w) || LINK.test(w) || /\d/.test(w) || numberWord(w)) return false
    if (strip(bare1(w)).length < 2) return false
    return nameGroup(w) >= 0 || nameGroup(bare1(w)) >= 0 || vehicles.some((v) => fitsCar(w, v))
  }
  const number = (i: number) => {
    if (used[i]) return null
    const num = numberAt(ws, i)
    return num && num.digits.length >= 2 && !ws.slice(i, i + num.n).some((_, k) => used[i + k]) ? num : null
  }
  const build = (at: number, end: number, digits: string, said: string[]): CarRef => {
    for (let k = at; k < end; k++) used[k] = true
    const byDigits = digits ? vehicles.filter((v) => plateDigits(v).endsWith(digits)) : vehicles
    const fitting = byDigits.filter((v) => said.every((w) => fitsCar(w, v)))
    if (fitting.length || !digits) return { at, n: end - at, digits, said, ids: fitting.map((v) => v.id), wrong: [] }
    // The digits name a vehicle, the make or model said is of another one: the manager is corrected.
    const wrong = said.filter((w) => !byDigits.every((v) => fitsCar(w, v)))
    return { at, n: end - at, digits, said, ids: byDigits.map((v) => v.id), wrong }
  }
  for (let i = 0; i < ws.length; i++) {
    if (used[i]) continue
    if (CAR_WORD.test(ws[i])) {
      let j = i + 1
      const said: string[] = []
      while (j < ws.length && LINK.test(ws[j]) && !used[j]) j++
      while (said.length < 3 && isCarWord(j)) said.push(ws[j++])
      while (j < ws.length && LINK.test(ws[j]) && !used[j]) j++
      const num = number(j)
      if (num) {
        j += num.n
        while (said.length < 4 && isCarWord(j)) said.push(ws[j++])
      }
      if (!num && !said.length) continue // "הרכב" alone names no vehicle
      return build(i, j, num?.digits ?? '', said)
    }
  }
  // No "רכב": digits next to a make or model ("הדימקס 345", "את 678 ברלינגו").
  for (let i = 0; i < ws.length; i++) {
    if (!DIGITS.test(ws[i] ?? '')) continue
    const num = number(i)
    if (!num) continue
    let start = i
    const before: string[] = []
    while (before.length < 2 && start > 0 && isCarWord(start - 1)) before.unshift(ws[--start])
    let end = i + num.n
    const after: string[] = []
    while (after.length < 3 && isCarWord(end)) after.push(ws[end++])
    if (!before.length && !after.length) continue
    return build(start, end, num.digits, [...before, ...after])
  }
  return undefined
}

/** The said make or model words, put back together: "דאצ'יה". */
const saidText = (ws: string[]) => ws.map(bare1).join(' ')

/**
 * Up to three vehicles near what was said, closest first. Digits: the last digits differ in one place
 * ("688" for 683). Make or model: the nearest sound to each word said.
 */
export function nearCars(ref: CarRef, vehicles: Vehicle[]): Vehicle[] {
  const scored = vehicles.map((v) => {
    let s = Infinity
    if (ref.digits) {
      const mine = plateDigits(v).slice(-ref.digits.length)
      if (mine.length === ref.digits.length) {
        const off = [...mine].filter((c, i) => c !== ref.digits[i]).length
        if (off === 1) s = 1
      }
    } else if (ref.said.length) {
      const ws = carWords(v)
      s = ref.said.reduce((sum, w) => sum + Math.min(...ws.map((x) => Math.min(nameDistance(strip(w), strip(x)), nameDistance(strip(bare1(w)), strip(x))))), 0)
      if (s > 2 * ref.said.length) s = Infinity
    }
    return { v, s }
  })
  return scored
    .filter((r) => r.s < Infinity)
    .sort((a, b) => a.s - b.s)
    .slice(0, 3)
    .map((r) => r.v)
}

/** What the vehicle said comes to: one vehicle (maybe with a correction), several (ask), or none. */
export type CarPick =
  | { kind: 'one'; vehicle: Vehicle; note: string }
  | { kind: 'many'; vehicles: Vehicle[]; question: string }
  | { kind: 'none'; text: string }

export function pickCar(ref: CarRef, vehicles: Vehicle[]): CarPick {
  const found = ref.ids.map((id) => vehicles.find((v) => v.id === id)).filter((v): v is Vehicle => Boolean(v))
  if (!found.length) {
    // The closest vehicles are offered by their digits, make and model (the owner, 2026-11-23); never a guess.
    const near = nearCars(ref, vehicles)
    const hint = near.length ? ` הכי ${near.length === 1 ? 'קרוב' : 'קרובים'}: ${near.map(carText).join('; ')}.` : ''
    if (ref.digits) return { kind: 'none', text: `לא מצאתי רכב שמספר הרישוי שלו נגמר ב-${ref.digits}.${hint} אפשר לומר שוב את שלוש הספרות האחרונות, או לבדוק במסך הרכבים.` }
    const none = near.length ? '.' : ', ואין אצלנו יצרן או דגם דומה.'
    return { kind: 'none', text: `לא מצאתי אצלנו רכב ${saidText(ref.said)}${none}${hint} אפשר לומר את שלוש הספרות האחרונות של מספר הרישוי.` }
  }
  if (found.length > 1) {
    const sameDigits = new Set(found.map(last3)).size === 1
    // Two vehicles with the same last digits are told apart by make and model, others by their digits.
    const names = found.map((v) => (sameDigits ? carName(v) || plateOf(v) : `${last3(v)}${carName(v) ? ` ${carName(v)}` : ''}`))
    const list = names.length === 2 ? names.join(' או ') : `${names.slice(0, -1).join(', ')} או ${names[names.length - 1]}`
    const what = ref.digits ? `שמספר הרישוי שלהם נגמר ב-${ref.digits}` : saidText(ref.said)
    return { kind: 'many', vehicles: found, question: `יש ${found.length} רכבים ${what}: ${list}. איזה מהם?` }
  }
  const v = found[0]
  if (!ref.wrong.length) return { kind: 'one', vehicle: v, note: '' }
  const wrong = saidText(ref.wrong)
  const others = vehicles.filter((x) => x.id !== v.id && ref.wrong.every((w) => fitsCar(w, x)))
  const hint = others.length ? ` רכב ${wrong} אצלנו ${others.length === 1 ? 'הוא' : 'הם'} ${others.map(last3).join(' או ')}.` : ''
  return { kind: 'one', vehicle: v, note: `שים לב, רכב ${last3(v)} הוא ${carName(v)}, לא ${wrong}.${hint}` }
}

/** The answer to "איזה מהם?": the vehicle picked by its digits, make or model, or "הראשון"; null when it is not clear. */
export function answerCar(text: string, ws: string[], options: Vehicle[], ordinal: number | null): Vehicle | null {
  if (ordinal !== null) return options[ordinal] ?? null
  for (let i = 0; i < ws.length; i++) {
    const num = numberAt(ws, i)
    if (num && num.digits.length >= 2) {
      const hits = options.filter((v) => plateDigits(v).endsWith(num.digits))
      if (hits.length === 1) return hits[0]
    }
  }
  const said = ws.filter((w) => strip(bare1(w)).length >= 2 && !/\d/.test(w) && !numberWord(w) && !CAR_WORD.test(w))
  const hits = options.filter((v) => said.some((w) => fitsCar(w, v)) && said.every((w) => fitsCar(w, v) || !options.some((o) => fitsCar(w, o))))
  return hits.length === 1 && text.trim() ? hits[0] : null
}
