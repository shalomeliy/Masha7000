import { languageOf, SOURCE, type Language } from './languages'

// The app's words are written in Hebrew in the code, and `tx('...')` shows them in the language
// picked in Settings. Each language is one file of Hebrew -> translation (src/i18n/locales/), loaded
// before the app starts, so only the picked language is downloaded. A word with no translation yet
// is shown in English (or in Hebrew when English has none either). Picking a language saves it on this device and reloads the app.
// `{name}` in a text is filled from `params`.

const KEY = 'app.language'

const files = import.meta.glob<{ default: Record<string, string> }>('./locales/*.json')

let current: Language = languageOf(SOURCE)
let words: Record<string, string> = {}
let english: Record<string, string> = {} // for a text not translated yet: English reads better than Hebrew

function saved(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** Run once before the app's modules load (texts kept at module level are read at load). */
export async function initLanguage(): Promise<void> {
  apply(languageOf(saved() ?? SOURCE))
  const file = files[`./locales/${current.code}.json`]
  if (current.code === SOURCE) return
  const load = (f: (typeof files)[string] | undefined) => (f ? f().then((m) => m.default).catch(() => ({})) : Promise.resolve({}))
  ;[words, english] = await Promise.all([load(file), current.code === 'en' ? Promise.resolve({}) : load(files['./locales/en.json'])])
}

/** Only for tests and the first load: sets the language without saving. */
export function apply(lang: Language, dict?: Record<string, string>, fallback?: Record<string, string>) {
  current = lang
  if (dict) words = dict
  if (fallback) english = fallback
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang.code
    document.documentElement.dir = lang.dir
  }
}

export function setLanguage(code: string) {
  try {
    localStorage.setItem(KEY, code)
  } catch {
    // private mode: the language holds only until the page reloads
  }
  location.reload()
}

export const language = (): Language => current
export const isRtl = () => current.dir === 'rtl'

// A param that is null, undefined or false shows as nothing, as it would in JSX.
const show = (v: unknown) => (v === null || v === undefined || v === false ? '' : String(v))

export function tx(he: string, params?: Record<string, unknown>): string {
  const text = current.code === SOURCE ? he : (words[he] ?? english[he] ?? he)
  return params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? show(params[k]) : m)) : text
}

/** The locale for dates and sorting (Intl). */
export const locale = () => (current.code === SOURCE ? 'he-IL' : current.speech)

const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
const format = (opts: Intl.DateTimeFormatOptions, d: Date) => new Intl.DateTimeFormat(locale(), { ...opts, timeZone: 'UTC' }).format(d)

/** Weekday names, Sunday first: 'long' ("ראשון", "Sunday") or 'short' ("א", "Sun"). */
export function dayNames(style: 'long' | 'short' = 'long'): string[] {
  if (current.code === SOURCE) return style === 'long' ? HE_DAYS : ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']
  return Array.from({ length: 7 }, (_, i) => format({ weekday: style }, new Date(Date.UTC(2026, 0, 4 + i)))) // 4.1.2026 is a Sunday
}

/** Month names, January first. */
export function monthNames(): string[] {
  if (current.code === SOURCE) return HE_MONTHS
  return Array.from({ length: 12 }, (_, i) => format({ month: 'long' }, new Date(Date.UTC(2026, i, 15))))
}
