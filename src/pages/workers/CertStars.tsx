import { Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { Sheet, SheetActions } from '../../components/Sheet'
import { tx } from '../../i18n'
import { certStars, fullName, MAX_STARS, upsert } from '../../lib/catalog'
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

const HOLD_MS = 500

/** A number to one decimal, without a trailing ".0". */
const starText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/**
 * The worker's one average star on their card (the user's request, 2026-11-08). It sits inside the
 * card's button: a tap opens the card as before, a long press opens the per-certification stars.
 */
export function AverageStars({ worker, certIds, onHold }: { worker: Worker; certIds: string[]; onHold: () => void }) {
  const timer = useRef<number | undefined>(undefined)
  const held = useRef(false)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const avg = averageStars(worker, certIds)
  if (avg === null) return null
  const stop = () => window.clearTimeout(timer.current)
  // After a long press the finger's lift still sends a click: swallow it, so the card does not open too.
  const swallow = (e: MouseEvent) => {
    if (!held.current) return
    held.current = false
    e.preventDefault()
    e.stopPropagation()
  }
  return (
    <span
      role="img"
      aria-label={tx('דירוג ממוצע {v} מתוך 5', { v: starText(avg) })}
      title={tx('לחיצה ארוכה: הכוכבים בכל הסמכה')}
      onPointerDown={() => {
        held.current = false
        stop()
        timer.current = window.setTimeout(() => {
          held.current = true
          navigator.vibrate?.(20)
          onHold()
        }, HOLD_MS)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClickCapture={swallow}
      className="inline-flex shrink-0 select-none items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-200 [-webkit-touch-callout:none]"
    >
      <Star size={14} aria-hidden className="fill-amber-400 text-amber-400" />
      <span dir="ltr">{starText(avg)}</span>
    </span>
  )
}

/** The per-certification stars of one worker, opened by a long press on their average. */
export function RatingsSheet({ worker, onClose }: { worker: Worker | null; onClose: () => void }) {
  const workers = useDriveList('workers')
  const certs = useDriveList('certifications')
  const [draft, setDraft] = useState<Worker | null>(worker)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  useEffect(() => {
    setDraft(worker)
    setSaveError(null)
  }, [worker])

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setSaveError(null)
    try {
      // Saved onto the latest copy of the worker, so only the stars change.
      const current = workers.items.find((w) => w.id === draft.id) ?? draft
      const next = { ...current, certRatings: draft.certRatings }
      if (!draft.certRatings) delete next.certRatings
      await workers.save(upsert(workers.items, next))
      onClose()
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={worker !== null} title={worker ? tx('הכוכבים של {name}', { name: fullName(worker) }) : ''} onClose={onClose} locked={busy}>
      {draft && (
        <div className="space-y-4">
          <p className="text-sm text-slate-300">{tx('כמה כוכבים העובד מקבל בכל הסמכה. הכוכב שבכרטיס הוא הממוצע שלהם.')}</p>
          <CertStarsField worker={draft} certs={certs.items} onChange={setDraft} />
          <SheetActions onSave={save} onCancel={onClose} busy={busy} error={null} saveError={saveError} />
        </div>
      )}
    </Sheet>
  )
}
