// Shifts by hours (smart onboarding stage 2, docs/plans/hourly-shifts-PLAN.md): the wizard's shift choices and
// the shift types they become. Pure, no I/O. A team turns hours on with settings.shiftHours; the checks that use
// it are in src/lib/planner.ts (busyWith) and src/lib/constraints.ts (blockingConstraints).

import { tx } from '../i18n'
import { newId } from './catalog'
import type { ShiftDefinition } from '../types/models'

export type PresetKey = 'morning' | 'noon' | 'evening' | 'night' | 'fullDay' | 'nightToNoon'

export interface ShiftChoice {
  key: PresetKey
  on: boolean
  start: string
  end: string
}

/** The spec's suggestion: morning and evening picked; the two old-style types last, with fixed hours. */
export const DEFAULT_CHOICES: ShiftChoice[] = [
  { key: 'morning', on: true, start: '07:00', end: '15:00' },
  { key: 'noon', on: false, start: '12:00', end: '20:00' },
  { key: 'evening', on: true, start: '15:00', end: '23:00' },
  { key: 'night', on: false, start: '23:00', end: '07:00' },
  { key: 'fullDay', on: false, start: '07:00', end: '16:00' },
  { key: 'nightToNoon', on: false, start: '07:00', end: '16:00' },
]

/** The two choices whose hours are fixed: a day until 16:00, and a night until 16:00 the next day. */
export const FIXED_HOURS: PresetKey[] = ['fullDay', 'nightToNoon']

export const presetName = (key: PresetKey): string =>
  ({
    morning: tx('בוקר'),
    noon: tx('צהריים'),
    evening: tx('ערב'),
    night: tx('לילה'),
    fullDay: tx('יום'),
    nightToNoon: tx('לילה עד מחר 16:00'),
  })[key]

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** Why the choices cannot be saved, or null. */
export function choicesError(choices: ShiftChoice[]): string | null {
  const picked = choices.filter((c) => c.on)
  if (!picked.length) return tx('צריך לבחור לפחות משמרת אחת')
  if (picked.some((c) => !TIME.test(c.start) || !TIME.test(c.end))) return tx('צריך שעת התחלה ושעת סיום')
  if (picked.some((c) => !FIXED_HOURS.includes(c.key) && c.start === c.end)) return tx('שעת הסיום צריכה להיות שונה משעת ההתחלה')
  return null
}

const norm = (s: string) => s.trim().toLocaleLowerCase()

/** The type a choice stands for in the team's list: the old-style night by its mark, the rest by name. */
function typeOf(key: PresetKey, defs: ShiftDefinition[]): ShiftDefinition | undefined {
  if (key === 'nightToNoon') return defs.find((d) => d.endsNextDay === true && !d.thenJob)
  return defs.find((d) => norm(d.name) === norm(presetName(key)) && (key === 'fullDay' || d.endsNextDay !== true) && !d.thenJob)
}

/** The team's types as wizard choices (answering again); without hourly ones, the spec's suggestion. */
export function choicesFrom(defs: ShiftDefinition[]): ShiftChoice[] {
  const found = DEFAULT_CHOICES.map((c) => {
    const d = typeOf(c.key, defs)
    return d ? { ...c, on: true, ...(FIXED_HOURS.includes(c.key) ? {} : { start: d.startTime, end: d.endTime }) } : { ...c, on: false }
  })
  if (found.some((c) => c.on && !FIXED_HOURS.includes(c.key))) return found
  return DEFAULT_CHOICES.map((c) => (FIXED_HOURS.includes(c.key) ? { ...c, on: found.find((f) => f.key === c.key)!.on } : c))
}

/**
 * The team's shift types after the wizard: each picked choice updates the type it stands for, or is added.
 * A type the manager did not pick stays when shifts were already saved (they may point at it), and is dropped
 * for a team with no shifts yet (the starter types it never used).
 */
export function typesFromChoices(choices: ShiftChoice[], existing: ShiftDefinition[], hasShifts: boolean): ShiftDefinition[] {
  const picked = choices.filter((c) => c.on)
  const bothNights = picked.some((c) => c.key === 'night') && picked.some((c) => c.key === 'nightToNoon')
  const made = picked.map((c): ShiftDefinition => {
    const old = typeOf(c.key, existing)
    // The old "לילה" until 16:00 tomorrow next to a new 23:00 "לילה": it takes its own name, so the two differ.
    const name = old && !(bothNights && c.key === 'nightToNoon' && norm(old.name) === norm(presetName('night'))) ? old.name : presetName(c.key)
    const base = old ?? { id: newId(), name, requiredHeadcount: 1, requiredCertificationIds: [] }
    const { endsNextDay: _drop, ...rest } = { ...base, name, startTime: c.start, endTime: c.end } as ShiftDefinition
    return c.key === 'nightToNoon' ? { ...rest, endsNextDay: true } : c.key === 'fullDay' ? { ...rest, endsNextDay: false } : rest
  })
  const ids = new Set(made.map((d) => d.id))
  const kept = hasShifts ? existing.filter((d) => !ids.has(d.id)) : []
  return [...made, ...kept]
}

/** "07:00-15:00" for a type (the end may be the next day). */
export const hoursRange = (d: Pick<ShiftDefinition, 'startTime' | 'endTime'>) => `${d.startTime}-${d.endTime}`
