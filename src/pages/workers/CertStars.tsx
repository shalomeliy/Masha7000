import { Star } from 'lucide-react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { Sheet } from '../../components/Sheet'
import { tx } from '../../i18n'
import { certStars, fullName, MAX_STARS } from '../../lib/catalog'
import { averageStars, rateCert } from '../../lib/certRatings'
import { useDriveList } from '../../lib/data/useDriveList'
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

/** A number to one decimal, without a trailing ".0". */
const starText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/**
 * The worker's one average star on their card (the user's request, 2026-11-08). It sits inside the
 * card's button: a tap on the star shows the stars in each certification (view only); a tap anywhere
 * else on the card opens the worker's form, where the stars are edited.
 */
export function AverageStars({ worker, certIds, onOpen }: { worker: Worker; certIds: string[]; onOpen: () => void }) {
  const avg = averageStars(worker, certIds)
  if (avg === null) return null
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={tx('דירוג ממוצע {v} מתוך 5', { v: starText(avg) })}
      onClick={(e: MouseEvent) => {
        // Only the star's window opens, not the worker's form under it.
        e.preventDefault()
        e.stopPropagation()
        onOpen()
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        onOpen()
      }}
      className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2.5 text-xs font-semibold text-amber-200"
    >
      <Star size={14} aria-hidden className="fill-amber-400 text-amber-400" />
      <span dir="ltr">{starText(avg)}</span>
    </span>
  )
}

/** The stars of one worker in each certification, view only; opened by a tap on their average. */
export function RatingsSheet({ worker, onClose }: { worker: Worker | null; onClose: () => void }) {
  const certs = useDriveList('certifications')
  const held = worker ? certs.items.filter((c) => worker.certificationIds.includes(c.id)) : []
  return (
    <Sheet open={worker !== null} title={worker ? tx('הכוכבים של {name}', { name: fullName(worker) }) : ''} onClose={onClose}>
      {worker && (
        <div className="space-y-4">
          <ul className="space-y-1 rounded-xl border border-slate-800 bg-slate-950 p-2">
            {held.map((c) => {
              const stars = certStars(worker, c.id)
              return (
                <li key={c.id} className="flex min-h-10 items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm">{c.name}</span>
                  <span
                    role="img"
                    aria-label={stars === 0 ? tx('עוד לא דורג') : stars === 1 ? tx('כוכב אחד') : tx('{n} כוכבים', { n: stars })}
                    className="flex shrink-0 gap-1 px-2"
                  >
                    {Array.from({ length: MAX_STARS }, (_, i) => (
                      <Star key={i} size={20} aria-hidden className={i < stars ? 'fill-amber-400 text-amber-400' : 'text-slate-600'} />
                    ))}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="text-sm text-slate-400">{tx('הכוכב שבכרטיס הוא הממוצע. לשינוי הכוכבים פותחים את העובד לעריכה.')}</p>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 text-slate-200"
          >
            {tx('סגירה')}
          </button>
        </div>
      )}
    </Sheet>
  )
}
