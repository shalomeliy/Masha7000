import { tx } from '../i18n'
import { featureName, type FeatureId } from './features'

// Shali and features the team turned off (Settings > מסכים ותכונות). A request about one of them is
// answered here, free, and never goes to Claude: "התכונה כבויה, אפשר להדליק בהגדרות".
// One word family per feature that Shali can act on; sickness is the worker's status, so it is never blocked.

const WORDS: [FeatureId, RegExp][] = [
  ['vehicles', /(?:^|[\s,.])(?:ו?[הלבמש]?)?(?:רכב|רכבים|טנדר|משאית)(?=$|[\s,.?!])/],
  ['nightJobs', /(?:^|[\s,.])(?:ו?[הלבמש]?)?(?:לילה|לילות|לינה)(?=$|[\s,.?!])/],
  ['constraints', /(?:^|[\s,.])(?:ו?[הלבמש]?)?(?:חופש|חופשה|חופשות|אילוץ|אילוצים|מילואים|לימודים)(?=$|[\s,.?!])/],
  ['certs', /(?:^|[\s,.])(?:ו?[הלבמש]?)?(?:הסמכה|הסמכות|מוסמך|מוסמכים|מוסמכת|כוכבים)(?=$|[\s,.?!])/],
  ['departments', /(?:^|[\s,.])(?:ו?[הלבמש]?)?(?:מחלקה|מחלקות)(?=$|[\s,.?!])/],
  ['jobClosing', /(?:^|[\s,.])(?:ו?[הלבמש]?)?(?:סגירת|תסגור|לסגור)(?=$|[\s,.?!])/],
]

/** The first turned-off feature the sentence is about, or null. `certNames`: the team's certification names. */
export function offFeatureSaid(text: string, isOn: (id: FeatureId) => boolean, certNames: string[] = []): FeatureId | null {
  for (const [id, re] of WORDS) if (!isOn(id) && re.test(text)) return id
  if (!isOn('certs') && certNames.some((n) => n.trim().length > 1 && text.includes(n.trim()))) return 'certs'
  return null
}

export const offFeatureAnswer = (id: FeatureId) => tx('{name} כבוי אצלך. אפשר להדליק בהגדרות, במסכים ותכונות.', { name: featureName(id) })
