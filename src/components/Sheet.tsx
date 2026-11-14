import { tx } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode, TouchEvent } from 'react'
import { ArrowUp } from 'lucide-react'
import { holdBack } from './backStack'
import { DriveError } from './DriveError'
import { fitToKeyboard } from './keyboardFit'

// Bottom sheet on a native <dialog>: focus trap, Escape and the backdrop come from the browser.
// `locked` keeps it open while a save is in flight, so a failed save can still show its error.
// The phone's Back and a swipe to either side close it like Cancel.
export function Sheet({
  open,
  title,
  onClose,
  locked = false,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  locked?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const latest = useRef({ onClose, locked })
  useEffect(() => {
    latest.current = { onClose, locked }
  })
  // dir: 0 until the finger shows its way, then -1 (left), 1 (right), or null when it is not a sideways swipe.
  const drag = useRef<{ x: number; y: number; dx: number; dir: -1 | 1 | null | 0 } | null>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    // Opening lands focus on the title, not the first field: on iPhone a focused date box pops its picker by itself.
    if (open && !d.open) {
      heading.current?.setAttribute('autofocus', '')
      d.showModal()
      heading.current?.focus()
    }
    if (!open && d.open) d.close()
    d.style.transform = ''
    d.style.transition = ''
    if (!open) return
    const stopFit = fitToKeyboard(d)
    const stopBack = holdBack(() => {
      if (latest.current.locked) return true
      latest.current.onClose()
      return false
    })
    return () => {
      stopFit()
      stopBack()
    }
  }, [open])

  const slide = (x: number, animate: boolean) => {
    const d = ref.current
    if (!d) return
    d.style.transition = animate ? 'transform 150ms ease-out' : 'none'
    d.style.transform = x ? `translateX(${x}px)` : ''
  }

  const onTouchStart = (e: TouchEvent<HTMLDialogElement>) => {
    drag.current = null
    if (locked || e.touches.length !== 1 || !swipeable(e.target as Element, ref.current)) return
    drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, dir: 0 }
  }

  const onTouchMove = (e: TouchEvent<HTMLDialogElement>) => {
    const g = drag.current
    if (!g) return
    const dx = e.touches[0].clientX - g.x
    const dy = e.touches[0].clientY - g.y
    if (g.dir === 0) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return
      g.dir = Math.abs(dx) > Math.abs(dy) * 1.5 ? (dx < 0 ? -1 : 1) : null
    }
    if (!g.dir) return
    // Only the way it started: swiping back past the start puts the sheet back, it does not fling it the other way.
    g.dx = g.dir < 0 ? Math.min(0, dx) : Math.max(0, dx)
    slide(g.dx, false)
  }

  const onTouchEnd = () => {
    const g = drag.current
    drag.current = null
    if (!g?.dir) return
    const d = ref.current
    if (d && Math.abs(g.dx) > Math.max(80, d.clientWidth * 0.25) && !latest.current.locked) {
      slide(g.dir * d.clientWidth, true)
      setTimeout(() => latest.current.onClose(), 150)
    } else slide(0, true)
  }

  return (
    <dialog
      ref={ref}
      // A sheet opened from inside this one sends its own close and cancel up through React; only ours count.
      onClose={(e) => e.target === ref.current && onClose()}
      onCancel={(e) => locked && e.target === ref.current && e.preventDefault()}
      onClick={(e) => !locked && e.target === ref.current && onClose()}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        drag.current = null
        slide(0, true)
      }}
      aria-labelledby="sheet-title"
      className="mx-auto mt-auto mb-0 max-h-[calc(var(--sheet-vh,100dvh)*0.9)] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border border-slate-800 bg-slate-900 p-0 text-slate-100 backdrop:bg-black/60"
    >
      {open && (
        <div className="space-y-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <h2 ref={heading} id="sheet-title" tabIndex={-1} className="text-lg font-semibold focus:outline-none">
            {title}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  )
}

// A swipe starting in a text box, or in a row that scrolls sideways, belongs to that box; one in a sheet opened on top belongs to it.
function swipeable(target: Element, sheet: HTMLDialogElement | null): boolean {
  if (!sheet || target.closest('dialog') !== sheet) return false
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return false
  for (let el: Element | null = target; el && el !== sheet; el = el.parentElement) {
    const x = getComputedStyle(el).overflowX
    if ((x === 'auto' || x === 'scroll') && el.scrollWidth > el.clientWidth) return false
  }
  return true
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-slate-300">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-base text-slate-100 focus:border-sky-500 focus:outline-none'

export function Chips({ options, selected, onToggle }: { options: { id: string; name: string }[]; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.id)
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.id)}
            className={`min-h-11 rounded-full border px-4 text-sm ${
              on ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300'
            }`}
          >
            {o.name}
          </button>
        )
      })}
    </div>
  )
}

/** Save / cancel row, plus a two-step delete when `onDelete` is given. */
export function SheetActions({
  onSave,
  onCancel,
  onDelete,
  deleteWarning,
  deleteLabel = tx('מחיקה'),
  confirmLabel = tx('כן, למחוק'),
  saveLabel = tx('שמירה'),
  busy,
  error,
  errorTarget,
  saveError,
}: {
  onSave: () => void
  onCancel: () => void
  onDelete?: () => void
  deleteWarning?: string
  deleteLabel?: string
  confirmLabel?: string
  saveLabel?: string
  busy: boolean
  error: string | null // validation
  errorTarget?: string // CSS selector of what the error is about, when the error's words do not name a field
  saveError: unknown
}) {
  const [confirming, setConfirming] = useState(false)


  return (
    <div className="space-y-3">
      {error && (
        // A tap takes the manager to the field the note is about (the user's request, 2026-11-13).
        <button
          type="button"
          role="alert"
          onClick={(e) => goToField(e.currentTarget, error, errorTarget)}
          className="flex w-full items-start gap-1 text-start text-sm text-red-300 underline decoration-red-300/40 underline-offset-4"
        >
          <ArrowUp size={16} aria-hidden className="mt-0.5 shrink-0" />
          {error}
        </button>
      )}
      {saveError != null && <DriveError error={saveError} action="save" />}
      {confirming ? (
        <div className="space-y-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3">
          <p className="text-sm text-red-200">{deleteWarning ?? tx('למחוק? אי אפשר לבטל את זה.')}</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={onDelete} className="min-h-11 flex-1 rounded-xl bg-red-500 font-semibold text-slate-950 disabled:opacity-50">
              {confirmLabel}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-11 flex-1 rounded-xl border border-slate-700 text-slate-300">
              {tx('לא')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={onSave} className="min-h-12 flex-[2] rounded-xl bg-sky-500 font-semibold text-slate-950 disabled:opacity-50">
            {busy ? tx('שומר...') : saveLabel}
          </button>
          <button type="button" disabled={busy} onClick={onCancel} className="min-h-12 flex-1 rounded-xl border border-slate-700 text-slate-300 disabled:opacity-50">
            {tx('ביטול')}
          </button>
          {onDelete && (
            <button type="button" onClick={() => setConfirming(true)} className="min-h-12 flex-1 rounded-xl border border-red-500/50 text-red-300">
              {deleteLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const FIELDS = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'

/**
 * Scrolls the form to what a validation note is about and puts the cursor there: `target` when given,
 * else a field marked invalid, else the field whose label the note names ("צריך למלא מיקום..." -> "מיקום"),
 * else the first field of the form.
 */
export function goToField(from: HTMLElement, error: string, target?: string) {
  const root = from.closest('dialog') ?? from.closest('form') ?? document.body
  const inForm = (el: Element) => !from.parentElement?.contains(el)
  const named = () => {
    let best: { el: Element; at: number; len: number } | null = null
    for (const el of root.querySelectorAll('label > span, legend, label, p, span')) {
      if (!inForm(el) || el.children.length) continue
      const text = el.textContent?.trim() ?? ''
      if (text.length < 2 || text.length > 40) continue
      const at = error.indexOf(text)
      if (at < 0) continue
      // A whole word only: "תאריך" is not in "מהתאריכים".
      const before = error[at - 1]
      const after = error[at + text.length]
      if ((before && /[\p{L}]/u.test(before)) || (after && /[\p{L}]/u.test(after))) continue
      if (!best || at < best.at || (at === best.at && text.length > best.len)) best = { el, at, len: text.length }
    }
    return best?.el.closest('label, fieldset, .space-y-1, .space-y-2') ?? best?.el ?? null
  }
  const spot =
    (target ? root.querySelector(target) : null) ??
    [...root.querySelectorAll('[aria-invalid="true"]')].find(inForm) ??
    named() ??
    [...root.querySelectorAll(FIELDS)].find(inForm) ??
    null
  if (!spot) return
  spot.scrollIntoView({ block: 'center' })
  const field = spot.matches(FIELDS) ? spot : spot.querySelector(FIELDS)
  ;(field as HTMLElement | null)?.focus({ preventScroll: true })
  // A short ring, so the eye finds it.
  spot.classList.add('ring-2', 'ring-red-400', 'rounded-xl')
  setTimeout(() => spot.classList.remove('ring-2', 'ring-red-400', 'rounded-xl'), 1600)
}
