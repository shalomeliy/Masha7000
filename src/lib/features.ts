// Which screens and features a manager sees (smart onboarding, docs/specs/smart-onboarding.md).
// The flags live in the manager's Drive settings.json (`features`). Turning one off only hides it:
// no data is deleted, and turning it back on brings everything back.
// A manager with no `onboarding` record (the owner and every manager from before this feature) sees everything.

import { tx } from '../i18n'
import type { AppSettings } from '../types/models'

export const FEATURE_IDS = [
  'nightJobs',
  'certs',
  'certExpiry',
  'vehicles',
  'departments',
  'constraints',
  'constraintForm',
  'joinForm',
  'jobClosing',
  'reports',
  'shali',
  'journal',
  'quickLists',
  'api',
] as const
export type FeatureId = (typeof FEATURE_IDS)[number]
export type FeatureFlags = Partial<Record<FeatureId, boolean>>

/** A feature that only works on top of another one. */
export const NEEDS: Partial<Record<FeatureId, FeatureId>> = { certExpiry: 'certs', constraintForm: 'constraints' }

export const featureName = (id: FeatureId): string =>
  ({
    nightJobs: tx('עבודות לילה'),
    certs: tx('הסמכות וכוכבים'),
    certExpiry: tx('תוקף הסמכות'),
    vehicles: tx('רכבים'),
    departments: tx('מחלקות'),
    constraints: tx('אילוצים'),
    constraintForm: tx('טופס אילוצים שבועי'),
    joinForm: tx('טופס הצטרפות'),
    jobClosing: tx('סגירת עבודה ועבודות ממתינות'),
    reports: tx('ארכיון ודוחות'),
    shali: tx('Shali (עוזר קולי)'),
    journal: tx('יומן אישי'),
    quickLists: tx('רשימות לבחירה מהירה'),
    api: tx('גישת API'),
  })[id]

export const featureHint = (id: FeatureId): string =>
  ({
    nightJobs: tx('בחירה בין עבודת יום ללילה, ואזהרה על יותר מ-2 לילות בשבוע'),
    certs: tx('"שבץ" בוחר רק עובד עם ההסמכה הנדרשת'),
    certExpiry: tx('תאריך תוקף לכל הסמכה, והתראה לפני שפג'),
    vehicles: tx('רשימת רכבים ובחירת רכב בעבודה'),
    departments: tx('חלוקת העובדים למחלקות בצבעים'),
    constraints: tx('חופשות, מחלה וימים שעובד לא יכול'),
    constraintForm: tx('קישור שבועי בוואטסאפ שבו העובדים ממלאים אילוצים'),
    joinForm: tx('קישור שבו עובד חדש ממלא את הפרטים בעצמו'),
    jobClosing: tx('סימון עבודה כהושלמה, ועבודות שמחכות לתאריך'),
    reports: tx('עבודות ישנות ודוח חודשי לעובד'),
    shali: tx('ניהול בקול: הכפתור הצהוב במרכז'),
    journal: tx('היומן האישי של כל עובד'),
    quickLists: tx('מקומות ותיאורי עבודה קבועים לבחירה בלחיצה'),
    api: tx('מפתחות לחיבור מערכות אחרות'),
  })[id]

/** Everything on: a manager who never went through the wizard. */
export const ALL_ON: Record<FeatureId, boolean> = Object.fromEntries(FEATURE_IDS.map((id) => [id, true])) as Record<FeatureId, boolean>

/**
 * The effective on/off set. Without an onboarding record everything is on. With one, a feature is on only
 * when it was saved as on (so a feature added in a later version never turns itself on) and the one it needs is on.
 */
export function resolveFeatures(settings: Pick<AppSettings, 'features' | 'onboarding'> | null | undefined): Record<FeatureId, boolean> {
  if (!settings?.onboarding) return { ...ALL_ON }
  const saved = settings.features ?? {}
  // A feature added after the save: off for a team that answered the wizard (it chose what it wants),
  // on for a team that only flipped a switch in Settings (it never chose about the rest).
  const switchOnly = !Object.keys(settings.onboarding.answers ?? {}).length
  const on = (id: FeatureId): boolean => {
    const need = NEEDS[id]
    const own = saved[id] === true || (switchOnly && saved[id] === undefined)
    return own && (need ? on(need) : true)
  }
  return Object.fromEntries(FEATURE_IDS.map((id) => [id, on(id)])) as Record<FeatureId, boolean>
}

/** Turning one off also turns off what needs it; turning one on also turns on what it needs. */
export function withFeature(flags: Record<FeatureId, boolean>, id: FeatureId, on: boolean): Record<FeatureId, boolean> {
  const next = { ...flags, [id]: on }
  if (on) {
    const need = NEEDS[id]
    return need ? withFeature(next, need, true) : next
  }
  for (const other of FEATURE_IDS) if (NEEDS[other] === id && next[other]) Object.assign(next, withFeature(next, other, false))
  return next
}

// ---- The wizard's answers (spec table). Each question has fixed answer ids; the free-text ones are kept apart.

export type Answers = Partial<{
  business: 'field' | 'security' | 'maintenance' | 'other'
  size: 'upTo10' | 'upTo30' | 'upTo100' | 'more'
  shifts: 'day' | 'dayNight'
  certs: 'withExpiry' | 'noExpiry' | 'no'
  vehicles: 'yes' | 'no'
  departments: 'yes' | 'no'
  constraints: 'none' | 'tellMe' | 'weeklyForm'
  join: 'link' | 'iType'
  closing: 'yes' | 'no'
  shali: 'yes' | 'no'
}>

/** Wizard answers -> flags. A question left unanswered keeps its feature on (nothing hidden by surprise). */
export function answersToFeatures(a: Answers): Record<FeatureId, boolean> {
  const yes = (v: string | undefined, ...offs: string[]) => v === undefined || !offs.includes(v)
  return {
    nightJobs: yes(a.shifts, 'day'),
    certs: yes(a.certs, 'no'),
    certExpiry: yes(a.certs, 'no', 'noExpiry'),
    vehicles: yes(a.vehicles, 'no'),
    departments: yes(a.departments, 'no'),
    constraints: yes(a.constraints, 'none'),
    constraintForm: yes(a.constraints, 'none', 'tellMe'),
    joinForm: yes(a.join, 'iType'),
    jobClosing: yes(a.closing, 'no'),
    reports: yes(a.closing, 'no'),
    shali: yes(a.shali, 'no'),
    journal: true,
    quickLists: true,
    api: false,
  }
}

/** Defaults the first question suggests for the rest (the manager can still change each answer). */
export function suggestedAnswers(business: NonNullable<Answers['business']>): Answers {
  switch (business) {
    case 'security':
      return { shifts: 'dayNight', certs: 'withExpiry', vehicles: 'no', constraints: 'weeklyForm' }
    case 'maintenance':
      return { shifts: 'day', certs: 'withExpiry', vehicles: 'yes', constraints: 'tellMe' }
    case 'field':
      return { shifts: 'dayNight', certs: 'withExpiry', vehicles: 'yes', constraints: 'weeklyForm' }
    default:
      return {}
  }
}

/** Departments are suggested from 31 workers up. */
export const suggestsDepartments = (size: Answers['size']) => size === 'upTo100' || size === 'more'
