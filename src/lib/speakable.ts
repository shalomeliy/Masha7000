// Text and voice choices for reading replies aloud with the browser's own (free) speech synthesis.
// Pure functions, kept apart from speech.ts so they can be tested without a browser.

export interface VoiceLike {
  name: string
  lang: string
  localService: boolean
  voiceURI: string
}

/** Does this voice speak the language? Old Android and Chrome still name Hebrew "iw". */
export function speaksLanguage(v: VoiceLike, code: string): boolean {
  const lang = v.lang.toLowerCase().replace('_', '-')
  const codes = code === 'he' ? ['he', 'iw'] : [code]
  return codes.some((c) => lang === c || lang.startsWith(`${c}-`))
}

// Higher is better. The "natural" / "neural" / "online" voices (Edge, newer Windows and Android) and
// the "enhanced" / "premium" ones on iPhone sound far more human than the old built-in ones.
function quality(v: VoiceLike): number {
  const n = v.name.toLowerCase()
  let s = 0
  if (/natural|neural/.test(n)) s += 40
  if (/premium|enhanced|משופר/.test(n)) s += 30
  if (/online/.test(n)) s += 20
  if (/google/.test(n)) s += 15
  if (/compact|eloquence/.test(n)) s -= 20
  return s
}

/** The language's voices, best-sounding first. */
export function rankVoices<V extends VoiceLike>(voices: readonly V[], code: string): V[] {
  return voices
    .filter((v) => speaksLanguage(v, code))
    .map((v, i) => ({ v, i }))
    .sort((a, b) => quality(b.v) - quality(a.v) || a.i - b.i)
    .map((x) => x.v)
}

/** A short name to show on the button: "Microsoft Hila Online (Natural) - Hebrew (Israel)" -> "Hila". */
export function shortVoiceName(v: VoiceLike): string {
  const name = v.name
    .replace(/\s*[-–(].*$/, '')
    .replace(/^(microsoft|google|apple)\s+/i, '')
    .trim()
  return name || v.name
}

/**
 * Text as it should be read aloud: dates as "15 בנובמבר" instead of "15 נקודה 11", "07:00" as "7:00",
 * and no symbols or emojis that the voice would spell out.
 */
// The assistant's name is Shali, said with the stress on the last syllable (Sha-LEE, מלרע; owner's
// choice 2026-11-14). Written "Shali" the voice may stress the first syllable, so it is read as "Shalee",
// on the phone's voice and on the cloud voice alike. The old name "Shaly" is read the same way.
export const NAME_SAID = 'Shalee'

export function speakable(text: string, locale: string): string {
  const month = (d: number, m: number, y?: number) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', ...(y ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(
      new Date(Date.UTC(y ?? 2000, m - 1, d)),
    )
  const valid = (d: number, m: number) => d >= 1 && d <= 31 && m >= 1 && m <= 12
  return (
    text
      // 2026-11-15
      .replace(/(?<![\d.])(\d{4})-(\d{2})-(\d{2})(?![\d])/g, (all, y, m, d) => (valid(+d, +m) ? month(+d, +m, +y) : all))
      // 15.11.2026, 15/11/26, 15.11, 15/11
      .replace(/(?<![\d.:/])(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?(?![\d%]|[./]\d|\s*(?:שעות|שעה|ימים|לילות|אחוז|hours?|days?|%))/g, (all, d, m, y) => {
        if (!valid(+d, +m)) return all
        const year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : undefined
        return month(+d, +m, year)
      })
      // 07:00 -> 7:00
      .replace(/(?<![\d:])0(\d):(\d{2})(?!\d)/g, (_, h, mm) => `${h}:${mm}`)
      .replace(/\bShal[iy]\b/g, NAME_SAID)
      .replace(/\s*(?:->|→|←|=>)\s*/g, ', ')
      .replace(/[*#_`~|<>[\]{}]/g, '')
      .replace(/\p{Extended_Pictographic}️?/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  )
}
