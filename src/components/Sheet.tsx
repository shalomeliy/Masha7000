import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DriveError } from './DriveError'

// Bottom sheet on a native <dialog>: focus trap, Escape and the backdrop come from the browser.
// `locked` keeps it open while a save is in flight, so a failed save can still show its error.
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

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => locked && e.preventDefault()}
      onClick={(e) => !locked && e.target === ref.current && onClose()}
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
  busy,
  error,
  saveError,
}: {
  onSave: () => void
  onCancel: () => void
  onDelete?: () => void
  deleteWarning?: string
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
              כן, למחוק
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-11 flex-1 rounded-xl border border-slate-700 text-slate-300">
              לא
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={onSave} className="min-h-12 flex-[2] rounded-xl bg-sky-500 font-semibold text-slate-950 disabled:opacity-50">
            {busy ? 'שומר...' : 'שמירה'}
          </button>
          <button type="button" disabled={busy} onClick={onCancel} className="min-h-12 flex-1 rounded-xl border border-slate-700 text-slate-300 disabled:opacity-50">
            ביטול
          </button>
          {onDelete && (
            <button type="button" onClick={() => setConfirming(true)} className="min-h-12 flex-1 rounded-xl border border-red-500/50 text-red-300">
              מחיקה
            </button>
          )}
        </div>
      )}
    </div>
  )
}
