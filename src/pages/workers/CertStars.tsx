import { ChevronDown, Star, Trash2 } from 'lucide-react'
import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Sheet } from '../../components/Sheet'
import { tx } from '../../i18n'
import { DateField } from '../../components/DateField'
import { certStars, fullName, MAX_STARS } from '../../lib/catalog'
import { daysLeftText, expiryNote, expiryState, setCertExpiry } from '../../lib/certExpiry'
import { averageStars, rateCert } from '../../lib/certRatings'
import { todayIso } from '../../lib/dates'
import { useDriveList } from '../../lib/data/useDriveList'
import type { Worker } from '../../types/models'

// The manager's own 1-5 star rating of a worker in each certification they hold (the user's
// request, 2026-11-08). The rules are in src/lib/certRatings.ts.

/** Orange for a certification that ends within 30 days, red for an expired one (src/lib/certExpiry.ts). */
export const EXPIRY_TONE = { soon: 'text-orange-300', expired: 'text-red-300' } as const

/** "פג תוקף ב-1.12.2026" in its color under a certification, or nothing when it is fine. */
export function ExpiryNote({ worker, certId, today }: { worker: Worker; certId: string; today: string }) {
  const state = expiryState(worker, certId, today)
  if (!state) return null
  return <span className={`block text-xs ${EXPIRY_TONE[state]}`}>{expiryNote(worker, certId, today)}</span>
}

/**
 * One row per certification the worker holds. Folded, a row shows the name (orange or red when it ends
 * soon or expired), the days left until it ends, and its stars (the manager's request, 2026-11-09). A
 * tap opens it: the same stars become tappable, and the date it is valid until shows under them, with
 * "הסר הסמכה" (2026-11-10). One row is open at a time.
 */
export function CertStarsField({
  worker,
  certs,
  onChange,
  onRemove,
}: {
  worker: Worker
  certs: { id: string; name: string; noExpiry?: true }[]
  onChange: (w: Worker) => void
  onRemove: (certId: string) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const held = certs.filter((c) => worker.certificationIds.includes(c.id))
  if (!held.length) return null
  const today = todayIso()
  return (
    <ul className="space-y-1 rounded-xl border border-slate-800 bg-slate-950 p-2">
      {held.map((c) => {
        const stars = certStars(worker, c.id)
        const state = expiryState(worker, c.id, today)
        // A certification marked "ללא תוקף" has no date at all.
        const dated = !c.noExpiry
        const left = dated ? daysLeftText(worker, c.id, today) : null
        const open = openId === c.id
        const toggle = () => setOpenId(open ? null : c.id)
        return (
          <li key={c.id} className="border-b border-slate-800/60 last:border-0">
            <div className="flex min-h-11 items-center gap-2">
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${tx('עריכת הסמכה')}: ${c.name}${left ? `, ${left}` : ''}`}
                onClick={toggle}
                className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 text-start"
              >
                <span className={`min-w-0 break-words text-sm leading-tight ${state ? EXPIRY_TONE[state] : ''}`}>{c.name}</span>
                {/* Open, the days left move next to the date, so a long name keeps the room the stars leave it. */}
                {left && !open && <span className={`shrink-0 text-xs ${state ? EXPIRY_TONE[state] : 'text-slate-400'}`}>{left}</span>}
              </button>
              {open ? (
                <span className="flex shrink-0" role="radiogroup" aria-label={tx('דירוג ב{name}', { name: c.name })}>
                  {Array.from({ length: MAX_STARS }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={stars === n}
                      aria-label={n === 1 ? tx('כוכב אחד') : tx('{n} כוכבים', { n })}
                      onClick={() => onChange(rateCert(worker, c.id, n))}
                      className="flex size-9 items-center justify-center"
                    >
                      <Star size={20} aria-hidden className={n <= stars ? 'fill-amber-400 text-amber-400' : 'text-slate-600'} />
                    </button>
                  ))}
                </span>
              ) : (
                <button type="button" tabIndex={-1} aria-hidden onClick={toggle} className="flex min-h-11 shrink-0 items-center gap-0.5">
                  {Array.from({ length: MAX_STARS }, (_, i) => (
                    <Star key={i} size={16} className={i < stars ? 'fill-amber-400 text-amber-400' : 'text-slate-600'} />
                  ))}
                </button>
              )}
              <button type="button" tabIndex={-1} aria-hidden onClick={toggle} className="flex size-8 shrink-0 items-center justify-center">
                <ChevronDown size={18} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {open && (
              <div className="space-y-2 pb-2">
                {dated && (
                <div className="flex items-end gap-3">
                  <div className="w-1/2 min-w-0">
                    <DateField
                      label={tx('בתוקף עד')}
                      value={worker.certExpiry?.[c.id] ?? ''}
                      onChange={(date, ok) => ok && onChange(setCertExpiry(worker, c.id, date))}
                    />
                  </div>
                  {left && <span className={`flex min-h-12 items-center text-sm ${state ? EXPIRY_TONE[state] : 'text-slate-400'}`}>{left}</span>}
                </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(null)
                    onRemove(c.id)
                  }}
                  className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm text-red-300"
                >
                  <Trash2 size={16} aria-hidden />
                  {tx('הסר הסמכה')}
                </button>
              </div>
            )}
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
                  <span className="min-w-0 text-sm">
                    <span className="block truncate">{c.name}</span>
                    <ExpiryNote worker={worker} certId={c.id} today={todayIso()} />
                  </span>
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
