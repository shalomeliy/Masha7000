import type { LucideIcon } from 'lucide-react'
import { Pencil, Phone, Plus } from 'lucide-react'
import { DriveError } from '../../components/DriveError'
import { fullName, telHref } from '../../lib/catalog'
import type { Worker } from '../../types/models'

export function AddButton({ label, onClick, icon: Icon = Plus }: { label: string; onClick: () => void; icon?: LucideIcon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 text-slate-200"
    >
      <Icon size={18} aria-hidden />
      {label}
    </button>
  )
}

export function EmptyState({
  text,
  addLabel,
  onAdd,
  starterLabel,
  onStarter,
  starterBusy,
  starterError,
}: {
  text: string
  addLabel: string
  onAdd: () => void
  starterLabel?: string
  onStarter?: () => void
  starterBusy?: boolean
  starterError?: unknown
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-sm text-slate-300">{text}</p>
      <button type="button" onClick={onAdd} className="min-h-12 w-full rounded-xl bg-sky-500 font-semibold text-slate-950">
        {addLabel}
      </button>
      {onStarter && (
        <button
          type="button"
          onClick={onStarter}
          disabled={starterBusy}
          className="min-h-12 w-full rounded-xl border border-slate-700 px-3 text-sm text-slate-200 disabled:opacity-50"
        >
          {starterBusy ? 'שומר...' : starterLabel}
        </button>
      )}
      {starterError != null && <DriveError error={starterError} action="save" />}
    </div>
  )
}

/** Pencil in the card's corner: tapping a card opens it for editing (delete is inside). Parent needs `relative`. */
export function EditMark() {
  return <Pencil size={16} aria-hidden className="pointer-events-none absolute end-3 top-3 text-slate-500" />
}

/** A worker's name; with a dialable mobile number, tapping it opens the phone's dialer with the number ready. */
export function WorkerDial({ worker, suffix, className = '' }: { worker: Worker | undefined; suffix?: string; className?: string }) {
  const name = worker ? fullName(worker) : 'עובד שנמחק'
  const dial = telHref(worker?.mobilePhone)
  const text = (
    <span className="truncate">
      {name}
      {suffix}
    </span>
  )
  if (!dial) return <span className={`inline-flex items-center ${className}`}>{text}</span>
  return (
    <a href={dial} aria-label={`חיוג אל ${name}`} className={`inline-flex items-center gap-1 ${className}`}>
      <Phone size={14} aria-hidden className="shrink-0 text-emerald-400" />
      {text}
    </a>
  )
}
