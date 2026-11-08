import { MAX_STARS } from './catalog'
import type { Worker } from '../types/models'

// The manager's 1-5 star rating of a worker in each certification (the user's request, 2026-11-08).
// A certification starts at the full 5; only a lower rating is saved.

/** The worker with `certId` rated `n` stars. */
export function rateCert(w: Worker, certId: string, n: number): Worker {
  const { [certId]: _, ...rest } = w.certRatings ?? {}
  const ratings = n >= MAX_STARS ? rest : { ...rest, [certId]: n }
  const { certRatings: _old, ...base } = w
  return Object.keys(ratings).length ? { ...base, certRatings: ratings } : base
}

/** The worker without the ratings of certifications they no longer hold. */
export function keepHeldRatings(w: Worker): Worker {
  if (!w.certRatings) return w
  const kept = Object.fromEntries(Object.entries(w.certRatings).filter(([id]) => w.certificationIds.includes(id)))
  const { certRatings: _, ...base } = w
  return Object.keys(kept).length ? { ...base, certRatings: kept } : base
}
