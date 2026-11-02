import { useState } from 'react'
import { ChevronDown, Minus, Plus } from 'lucide-react'
import { Chips } from '../../components/Sheet'
import { generalRoleId, MAX_STAFF, resizeStaffing, slotCerts } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import type { StaffSlot } from '../../types/models'

// Who a job needs: how many people, and for each one a role (default "כללי"), any certifications
// and any more roles the same person must hold (one welder-climber in place of two people). The automatic planner will staff the job from this. A place that came from a work
// kind shows the kind's name; with `alt`, a place may take a second role that also fills it.

const selectClass = 'min-h-11 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-2 text-sm'

export function StaffingField({ value, onChange, alt }: { value: StaffSlot[]; onChange: (next: StaffSlot[]) => void; alt?: boolean }) {
  const roles = useDriveList('roles')
  const kinds = useDriveList('workKinds')
  const certs = useDriveList('certifications')
  const general = generalRoleId(roles.items)
  const resize = (n: number) => onChange(resizeStaffing(value, n, general))
  const setSlot = (i: number, patch: Partial<StaffSlot>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const certNames = (s: StaffSlot) => slotCerts(s).flatMap((id) => certs.items.find((c) => c.id === id)?.name ?? [])
  const roleNames = (s: StaffSlot) => (s.alsoRoleIds ?? []).flatMap((id) => roles.items.find((r) => r.id === id)?.name ?? [])
  const needText = (s: StaffSlot) => [...roleNames(s).map((n) => `+ ${n}`), ...certNames(s)].join(', ')
  // Roles a place may also ask for: not "כללי", not its own.
  const moreRoles = (s: StaffSlot) => roles.items.filter((r) => r.id !== general && r.id !== s.roleId)
  const toggleOff = (ids: string[] | undefined, id: string) => (ids?.includes(id) ? toggle(ids, id) : ids)
  const [open, setOpen] = useState<number | null>(null)
  const toggle = (ids: string[], id: string) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    return next.length ? next : undefined
  }

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
          <li key={i} className="space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-2">
            <div className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-center text-sm text-slate-400">{i + 1}</span>
            <select
              aria-label={`תפקיד לאדם ${i + 1}`}
              value={s.roleId}
              // A new role here replaces the place's other roles too, except in the kind editor that shows them.
              onChange={(e) => setSlot(i, { roleId: e.target.value, alsoRoleIds: toggleOff(s.alsoRoleIds, e.target.value), altRoleIds: alt ? s.altRoleIds?.filter((id) => id !== e.target.value) : undefined })}
              className={selectClass}
            >
              {roles.items.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
<button
              type="button"
              aria-expanded={open === i}
              aria-label={`הסמכות ותפקידים נוספים לאדם ${i + 1}`}
              onClick={() => setOpen(open === i ? null : i)}
              className={`${selectClass} flex items-center justify-between gap-1 text-start`}
            >
              <span className="truncate">{needText(s) || 'בלי הסמכה'}</span>
              <ChevronDown size={16} className={`shrink-0 ${open === i ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            </div>
            {open === i && (
              <div className="space-y-2 ps-7">
                <span className="block text-xs text-slate-400">הסמכות (האדם צריך את כולן)</span>
                {certs.items.length ? (
                  <Chips options={certs.items} selected={slotCerts(s)} onToggle={(id) => setSlot(i, { certificationId: undefined, certificationIds: toggle(slotCerts(s), id) })} />
                ) : (
                  <p className="text-xs text-amber-300">עוד אין הסמכות.</p>
                )}
                {moreRoles(s).length > 0 && (
                  <>
                    <span className="block text-xs text-slate-400">תפקידים שאותו אדם צריך גם להחזיק</span>
                    <Chips options={moreRoles(s)} selected={s.alsoRoleIds ?? []} onToggle={(id) => setSlot(i, { alsoRoleIds: toggle(s.alsoRoleIds ?? [], id) })} />
                  </>
                )}
              </div>
            )}
            {alt ? (
              <select
                aria-label={`תפקיד נוסף שמתאים לאדם ${i + 1}`}
                value={s.altRoleIds?.[0] ?? ''}
                onChange={(e) => setSlot(i, { altRoleIds: e.target.value ? [e.target.value] : undefined })}
                className={`${selectClass} text-slate-300`}
              >
                <option value="">בלי תפקיד נוסף</option>
                {roles.items
                  .filter((r) => r.id !== s.roleId && r.id !== general)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      או {r.name}
                    </option>
                  ))}
              </select>
            ) : (
              (!!s.kindId || !!s.altRoleIds?.length) && (
                <p className="ps-7 text-xs text-slate-400">
                  {[
                    s.altRoleIds?.length && `מתאים גם: ${s.altRoleIds.map((id) => roles.items.find((r) => r.id === id)?.name).filter(Boolean).join(', ')}`,
                    s.kindId && `מתוך "${kinds.items.find((k) => k.id === s.kindId)?.name ?? 'סוג עבודה שנמחק'}"`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
