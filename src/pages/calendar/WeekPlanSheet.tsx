import { useState } from 'react'
import { Sheet, SheetActions } from '../../components/Sheet'
import { fullName, generalRoleId, staffingFor, upsert } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import { placeText } from '../../lib/gaps'
import { planShifts } from '../../lib/planner'
import { dayName, showDate } from '../../lib/shifts'
import type { ShiftRecord } from '../../types/models'

// "שבץ את השבוע": "שבץ" on every open shift of the week from today on, shown before anything is
// saved. Only empty places are filled; the manager's own picks stay. One save for all of it.

export function WeekPlanSheet({ shifts, onClose }: { shifts: ShiftRecord[] | null; onClose: () => void }) {
  const saved = useDriveList('shifts')
  return (
    <Sheet open={shifts !== null} title="תצוגה מקדימה: שיבוץ השבוע" onClose={onClose} locked={saved.saving}>
      {shifts && <WeekPlan shifts={shifts} onDone={onClose} />}
    </Sheet>
  )
}

function WeekPlan({ shifts, onDone }: { shifts: ShiftRecord[]; onDone: () => void }) {
  const saved = useDriveList('shifts')
  const workers = useDriveList('workers')
  const defs = useDriveList('shiftDefinitions')
  const roles = useDriveList('roles')
  const certs = useDriveList('certifications')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const certIds = certs.items.map((c) => c.id)
  // Planned once when the sheet opens, so the preview is exactly what "שמור הכול" saves.
  const [items] = useState(() =>
    planShifts(shifts, (r) => staffingFor(r.staffing, roles.items, certIds), {
      workers: workers.items,
      records: saved.items,
      defs: defs.items,
      generalId: generalRoleId(roles.items),
    }),
  )
  const changed = items.filter((i) => i.added.length > 0)
  const name = (id: string) => {
    const w = workers.items.find((x) => x.id === id)
    return w ? fullName(w) : 'עובד שנמחק'
  }
  const roleName = (id: string) => roles.items.find((r) => r.id === id)?.name ?? ''

  const save = async () => {
    if (!changed.length) return onDone()
    setBusy(true)
    setSaveError(null)
    try {
      await saved.save(changed.reduce((list, i) => upsert(list, i.shift), saved.items))
      onDone()
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="text-sm text-slate-300">
        {changed.length
          ? `${changed.length === 1 ? 'משמרת אחת תקבל' : `${changed.length} משמרות יקבלו`} עובדים. עובדים ששמת בעצמך נשארים. שום דבר לא נשמר עד "שמור הכול".`
          : 'לא נמצאו עובדים מתאימים למקומות הפנויים. שום דבר לא ישתנה.'}
      </p>
      <ul className="space-y-2">
        {items.map(({ shift: r, added, unfilled, why }) => (
          <li key={r.id} className={`space-y-1 rounded-xl border p-3 text-sm ${unfilled.length ? 'border-red-500/60' : 'border-slate-800'}`}>
            <p className="font-semibold">
              יום {dayName(r.date)} {showDate(r.date)}
              {r.location && ` · ${r.location}`}
            </p>
            {r.jobDescription && <p className="text-slate-400">{r.jobDescription}</p>}
            {added.map((c) => (
              <p key={c.workerId} className="text-emerald-300">
                + {name(c.workerId)}
                {roleName(c.roleId) && ` · ${roleName(c.roleId)}`}
              </p>
            ))}
            {unfilled.map((s, i) => (
              <p key={i} className="text-red-300">
                <span className="font-semibold">עדיין חסר: {placeText(s, roles.items, certs.items)}</span> · {why[i]}
              </p>
            ))}
          </li>
        ))}
      </ul>
      <SheetActions
        onSave={save}
        onCancel={onDone}
        saveLabel="שמור הכול"
        busy={busy}
        error={null}
        saveError={saveError}
      />
    </>
  )
}
