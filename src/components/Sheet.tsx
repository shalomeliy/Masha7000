import { useEffect, useRef, useState } from 'react'
import type { ReactNode, TouchEvent } from 'react'
import { holdBack } from './backStack'
import { DriveError } from './DriveError'

// Bottom sheet on a native <dialog>: focus trap, Escape and the backdrop come from the browser.
// `locked` keeps it open while a save is in flight, so a failed save can still show its error.
// The phone's Back and a swipe to the left close it like Cancel.
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
  const latest = useRef({ onClose, locked })
  useEffect(() => {
    latest.current = { onClose, locked }
  })
  const drag = useRef<{ x: number; y: number; dx: number; side: boolean | null } | null>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
    d.style.transform = ''
    d.style.transition = ''
    if (!open) return
    return holdBack(() => {
      if (latest.current.locked) return true
      latest.current.onClose()
      return false
    })
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
    drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, side: null }
  }

  const onTouchMove = (e: TouchEvent<HTMLDialogElement>) => {
    const g = drag.current
    if (!g) return
    const dx = e.touches[0].clientX - g.x
    const dy = e.touches[0].clientY - g.y
    if (g.side === null) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return
      g.side = dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.5
      if (!g.side) return
    }
    if (!g.side) return
    g.dx = Math.min(0, dx)
    slide(g.dx, false)
  }

  const onTouchEnd = () => {
    const g = drag.current
    drag.current = null
    if (!g?.side) return
    const d = ref.current
    if (d && g.dx < -Math.max(80, d.clientWidth * 0.25) && !latest.current.locked) {
      slide(-d.clientWidth, true)
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
      className="mx-auto mt-auto mb-0 max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border border-slate-800 bg-slate-900 p-0 text-slate-100 backdrop:bg-black/60"
    >
      {open && (
        <div className="space-y-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <h2 id="sheet-title" className="text-lg font-semibold">
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
  deleteLabel = 'מחיקה',
  confirmLabel = 'כן, למחוק',
  saveLabel = 'שמירה',
  busy,
  error,
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
  saveError: unknown
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {saveError != null && <DriveError error={saveError} action="save" />}
      {confirming ? (
        <div className="space-y-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3">
          <p className="text-sm text-red-200">{deleteWarning ?? 'למחוק? אי אפשר לבטל את זה.'}</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={onDelete} className="min-h-11 flex-1 rounded-xl bg-red-500 font-semibold text-slate-950 disabled:opacity-50">
              {confirmLabel}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-11 flex-1 rounded-xl border border-slate-700 text-slate-300">
              לא
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={onSave} className="min-h-12 flex-[2] rounded-xl bg-sky-500 font-semibold text-slate-950 disabled:opacity-50">
            {busy ? 'שומר...' : saveLabel}
          </button>
          <button type="button" disabled={busy} onClick={onCancel} className="min-h-12 flex-1 rounded-xl border border-slate-700 text-slate-300 disabled:opacity-50">
            ביטול
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
