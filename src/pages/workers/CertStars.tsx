import { Star } from 'lucide-react'
import { tx } from '../../i18n'
import { certStars, MAX_STARS } from '../../lib/catalog'
import { rateCert } from '../../lib/certRatings'
import type { Worker } from '../../types/models'

// The manager's own 1-5 star rating of a worker in each certification they hold (the user's
// request, 2026-11-08). The rules are in src/lib/certRatings.ts.

/** One row per certification the worker holds: its name and 5 stars to tap. */
export function CertStarsField({ worker, certs, onChange }: { worker: Worker; certs: { id: string; name: string }[]; onChange: (w: Worker) => void }) {
  const held = certs.filter((c) => worker.certificationIds.includes(c.id))
  if (!held.length) return null
  return (
    <ul className="space-y-1 rounded-xl border border-slate-800 bg-slate-950 p-2">
      {held.map((c) => {
        const stars = certStars(worker, c.id)
        return (
          <li key={c.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm">{c.name}</span>
            <span className="flex shrink-0" role="radiogroup" aria-label={tx('דירוג ב{name}', { name: c.name })}>
              {Array.from({ length: MAX_STARS }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={stars === n}
                  aria-label={n === 1 ? tx('כוכב אחד') : tx('{n} כוכבים', { n })}
                  onClick={() => onChange(rateCert(worker, c.id, n))}
                  className="flex size-10 items-center justify-center"
                >
                  <Star size={22} aria-hidden className={n <= stars ? 'fill-amber-400 text-amber-400' : 'text-slate-600'} />
                </button>
              ))}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
