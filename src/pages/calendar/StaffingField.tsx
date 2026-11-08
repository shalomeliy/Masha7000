import { tx } from '../../i18n'
import { useState } from 'react'
import { ChevronDown, Minus, Plus } from 'lucide-react'
import { Chips } from '../../components/Sheet'
import { MAX_STAFF, placeText, resizeStaffing, slotCerts } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import type { StaffSlot } from '../../types/models'

// Who a job needs: how many people, and for each one the certifications they must hold (none =
// any worker). "שבץ" staffs the job from this. A place that came from a work kind shows the kind's name.

const selectClass = 'min-h-11 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-2 text-sm'

export function StaffingField({ value, onChange }: { value: StaffSlot[]; onChange: (next: StaffSlot[]) => void }) {
  const kinds = useDriveList('workKinds')
  const certs = useDriveList('certifications')
  const resize = (n: number) => onChange(resizeStaffing(value, n))
  const setSlot = (i: number, patch: Partial<StaffSlot>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const [open, setOpen] = useState<number | null>(null)
  const toggle = (ids: string[], id: string) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    return next.length ? next : undefined
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-300">{tx('כמה אנשים צריך')}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={tx('פחות אנשים')}
            disabled={value.length <= 1}
            onClick={() => resize(value.length - 1)}
            className="flex size-11 items-center justify-center rounded-lg border border-slate-700 text-slate-200 disabled:opacity-40"
          >
            <Minus size={18} aria-hidden />
          </button>
          <span aria-live="polite" className="w-8 text-center text-lg font-semibold">
            {value.length}
          </span>
          <button
            type="button"
            aria-label={tx('עוד אדם')}
            disabled={value.length >= MAX_STAFF}
            onClick={() => resize(value.length + 1)}
            className="flex size-11 items-center justify-center rounded-lg border border-slate-700 text-slate-200 disabled:opacity-40"
          >
            <Plus size={18} aria-hidden />
          </button>
        </div>
      </div>
      <ol className="space-y-2">
        {value.map((s, i) => (
          <li key={i} className="space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-2">
            <div className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-center text-sm text-slate-400">{i + 1}</span>
<button
              type="button"
              aria-expanded={open === i}
              aria-label={tx('הסמכות לאדם {v}', { v: i + 1 })}
              onClick={() => setOpen(open === i ? null : i)}
              className={`${selectClass} flex items-center justify-between gap-1 text-start`}
            >
              <span className="truncate">{placeText(s, certs.items)}</span>
              <ChevronDown size={16} className={`shrink-0 ${open === i ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            </div>
            {open === i && (
              <div className="space-y-2 ps-7">
                <span className="block text-xs text-slate-400">{tx('הסמכות (האדם צריך את כולן)')}</span>
                {certs.items.length ? (
                  <Chips options={certs.items} selected={slotCerts(s)} onToggle={(id) => setSlot(i, { certificationId: undefined, certificationIds: toggle(slotCerts(s), id) })} />
                ) : (
                  <p className="text-xs text-amber-300">{tx('עוד אין הסמכות.')}</p>
                )}
              </div>
            )}
            {s.kindId && <p className="ps-7 text-xs text-slate-400">{tx('מתוך "{v}"', { v: kinds.items.find((k) => k.id === s.kindId)?.name ?? tx('סוג עבודה שנמחק') })}</p>}
          </li>
        ))}
      </ol>
    </div>
  )
}
