import { tx } from '../i18n'
import { featureName, type FeatureId } from './features'

// Shali and features the team turned off (Settings > מסכים ותכונות). A request about one of them is
// answered here, free, and never goes to Claude: "התכונה כבויה, אפשר להדליק בהגדרות".
// One word family per feature that Shali can act on; sickness is the worker's status, so it is never blocked.

// Only words that name the feature itself, not words a job description or a place may hold
// ("סגירת גדר", "ברכב של הלקוח", "המחלקה הפנימית" stay free requests). A vehicle is named the way the
// manager names one: "רכב" with its digits, "את (ה)רכב", or "רכבים".
const B = '(?:^|[\\s,.])'
const E = '(?=$|[\\s,.?!])'
const WORDS: [FeatureId, RegExp][] = [
  ['vehicles', new RegExp(`(?:ה?רכב\\s*\\d|${B}את\\s+ה?רכב${E}|${B}ו?[הל]?רכבים${E})`)],
  ['nightJobs', new RegExp(`${B}(?:ו?[הלב]?)?(?:לילה|לילות)${E}`)],
  ['constraints', new RegExp(`${B}(?:ו?[הלב]?)?(?:חופש|חופשה|חופשות|אילוץ|אילוצים|מילואים)${E}`)],
  ['certs', new RegExp(`${B}(?:ו?[הלב]?)?(?:הסמכה|הסמכות|מוסמך|מוסמכים|מוסמכת)${E}`)],
]
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The first turned-off feature the sentence is about, or null. `certNames`: the team's certification names. */
export function offFeatureSaid(text: string, isOn: (id: FeatureId) => boolean, certNames: string[] = []): FeatureId | null {
  for (const [id, re] of WORDS) if (!isOn(id) && re.test(text)) return id
  // A certification's own name, as a whole word (maybe with ה/ו/ל/ב before it): "שני חשמלאים", not "לוח חשמל" for "חשמלאי".
  if (!isOn('certs') && certNames.some((n) => n.trim().length > 2 && new RegExp(`${B}(?:ו?[הלב]?)?${escape(n.trim())}${E}`).test(text))) return 'certs'
  return null
}

export const offFeatureAnswer = (id: FeatureId) => tx('{name} כבוי אצלך. אפשר להדליק בהגדרות, במסכים ותכונות.', { name: featureName(id) })
