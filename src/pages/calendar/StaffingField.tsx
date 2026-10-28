import { Minus, Plus } from 'lucide-react'
import { generalRoleId, MAX_STAFF, resizeStaffing } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import type { StaffSlot } from '../../types/models'

// Who a job needs: how many people, and for each one a role (default "כללי") and an optional
// certification. The automatic planner will staff the job from this.

const selectClass = 'min-h-11 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-2 text-sm'

export function StaffingField({ value, onChange }: { value: StaffSlot[]; onChange: (next: StaffSlot[]) => void }) {
  const roles = useDriveList('roles')
  const certs = useDriveList('certifications')
  const general = generalRoleId(roles.items)
  const resize = (n: number) => onChange(resizeStaffing(value, n, general))
  const setSlot = (i: number, patch: Partial<StaffSlot>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-300">כמה אנשים צריך</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="פחות אנשים"
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
            aria-label="עוד אדם"
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
          <li key={i} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 p-2">
            <span className="w-5 shrink-0 text-center text-sm text-slate-400">{i + 1}</span>
            <select aria-label={`תפקיד לאדם ${i + 1}`} value={s.roleId} onChange={(e) => setSlot(i, { roleId: e.target.value })} className={selectClass}>
              {roles.items.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <select
              aria-label={`הסמכה לאדם ${i + 1}`}
              value={s.certificationId ?? ''}
              onChange={(e) => setSlot(i, { certificationId: e.target.value || undefined })}
              className={selectClass}
            >
              <option value="">בלי הסמכה</option>
              {certs.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ol>
    </div>
  )
}
