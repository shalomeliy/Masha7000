import { tx } from '../i18n'
import { GENERAL_CERT_ID } from './catalog'
import { addDays, showDate } from './shifts'
import type { Worker } from '../types/models'

// The date a worker's certification is valid until (the manager's request, 2026-11-09). The manager
// types it in the worker's form; none = it does not expire. From EXPIRY_WARN_DAYS before that day the
// certification shows orange with its date; after it, red. "שבץ" does not count a certification that
// has expired by the day of the job; the manager may still put the worker in by hand.

export const EXPIRY_WARN_DAYS = 30

export type ExpiryState = 'soon' | 'expired'

/** The worker with `certId` valid until `date` (YYYY-MM-DD); empty = no expiry. */
export function setCertExpiry(w: Worker, certId: string, date: string): Worker {
  const { [certId]: _, ...rest } = w.certExpiry ?? {}
  const dates = date ? { ...rest, [certId]: date } : rest
  const { certExpiry: _old, ...base } = w
  return Object.keys(dates).length ? { ...base, certExpiry: dates } : base
}

/** The worker without the expiry dates of certifications they no longer hold. */
export function keepHeldExpiry(w: Worker): Worker {
  if (!w.certExpiry) return w
  const kept = Object.fromEntries(Object.entries(w.certExpiry).filter(([id]) => w.certificationIds.includes(id)))
  const { certExpiry: _, ...base } = w
  return Object.keys(kept).length ? { ...base, certExpiry: kept } : base
}

/** Expired: valid until a day before `today`. Soon: it ends within EXPIRY_WARN_DAYS. Otherwise null. */
export function expiryState(w: Pick<Worker, 'certExpiry'>, certId: string, today: string): ExpiryState | null {
  const until = w.certExpiry?.[certId]
  if (!until) return null
  if (until < today) return 'expired'
  return until <= addDays(today, EXPIRY_WARN_DAYS) ? 'soon' : null
}

/** "פג תוקף ב-1.12.2026" or "התוקף נגמר ב-1.12.2026", or null when the certification is fine. */
export function expiryNote(w: Pick<Worker, 'certExpiry'>, certId: string, today: string): string | null {
  const state = expiryState(w, certId, today)
  if (!state) return null
  const until = w.certExpiry![certId]
  const v = `${showDate(until)}.${until.slice(0, 4)}`
  return state === 'expired' ? tx('פג תוקף ב-{v}', { v }) : tx('התוקף נגמר ב-{v}', { v })
}

/** How many of `certIds` the worker holds that end soon and that already expired. */
export function expiryCounts(w: Worker, certIds: string[], today: string): { soon: number; expired: number } {
  const held = certIds.filter((id) => w.certificationIds.includes(id))
  const states = held.map((id) => expiryState(w, id, today))
  return { soon: states.filter((s) => s === 'soon').length, expired: states.filter((s) => s === 'expired').length }
}

/** The worker as "שבץ" sees them on `date`: without the certifications expired by then ("כללי" never expires). */
export function validOn(w: Worker, date: string): Worker {
  if (!w.certExpiry) return w
  const ids = w.certificationIds.filter((id) => id === GENERAL_CERT_ID || expiryState(w, id, date) !== 'expired')
  return ids.length === w.certificationIds.length ? w : { ...w, certificationIds: ids }
}
