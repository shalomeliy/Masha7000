import { useState } from 'react'
import { Chips, Field, inputClass, Sheet, SheetActions } from '../../components/Sheet'
import { countText, endsNextDay, newId, SHIFT_END, SHIFT_START, shiftError, STANDBY_HEADCOUNT, STARTER_SHIFTS, tagNames, upsert } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import type { ShiftDefinition } from '../../types/models'
import { AddButton, EditMark, EmptyState } from './common'

const blankShift = (): ShiftDefinition => ({
  id: newId(),
  name: '',
  startTime: SHIFT_START,
  endTime: SHIFT_END,
  requiredHeadcount: 1,
  requiredRoleIds: [],
  requiredCertificationIds: [],
})

const hoursText = (s: ShiftDefinition) => `נגמרת ב-${s.endTime}${endsNextDay(s) ? ' למחרת' : ''}`

export function ShiftsSection() {
  const shifts = useDriveList('shiftDefinitions')
  const roles = useDriveList('roles')
  const certs = useDriveList('certifications')
  const [editing, setEditing] = useState<ShiftDefinition | null>(null)
  const [starterError, setStarterError] = useState<unknown>(null)

  const addStarter = async () => {
    setStarterError(null)
    try {
      await shifts.save(STARTER_SHIFTS.map((s) => ({ ...s, id: newId() })))
    } catch (e) {
      setStarterError(e)
    }
  }

  return (
    <>
      {shifts.items.length === 0 ? (
        <EmptyState
          text="סוג משמרת אומר אם היא נגמרת באותו יום או למחרת, כמה אנשים צריך בה ואילו תפקידים והסמכות חייבים להיות בה."
          addLabel="הוספת סוג משמרת"
          onAdd={() => setEditing(blankShift())}
          starterLabel="להתחיל עם: יום (עד 16:00), לילה (עד 16:00 למחרת)"
          onStarter={addStarter}
          starterBusy={shifts.saving}
          starterError={starterError}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {shifts.items.map((s) => {
              const names = [...tagNames(s.requiredRoleIds, roles.items), ...tagNames(s.requiredCertificationIds, certs.items)]
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(s)}
                    className="relative w-full space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-4 pe-9 text-start"
                  >
                    <EditMark />
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-semibold">
                        {s.name}
                        {s.isStandby && <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-xs text-violet-200">כוננות</span>}
                      </span>
                      <span className="text-sm text-slate-400">{countText(s.requiredHeadcount ?? 1, 'אדם אחד', 'אנשים')}</span>
                    </span>
                    <span className="block text-sm text-slate-300">{hoursText(s)}</span>
                    <span className="block text-xs text-slate-400">
                      {names.length ? `נדרש: ${names.join(', ')}` : 'אין תפקיד או הסמכה נדרשים'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <AddButton label="הוספת סוג משמרת" onClick={() => setEditing(blankShift())} />
        </>
      )}

      <Sheet
        open={editing !== null}
        title={editing && shifts.items.some((s) => s.id === editing.id) ? 'עריכת סוג משמרת' : 'סוג משמרת חדש'}
        onClose={() => setEditing(null)}
        locked={shifts.saving}
      >
        {editing && <ShiftForm shift={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </>
  )
}

function ShiftForm({ shift, onDone }: { shift: ShiftDefinition; onDone: () => void }) {
  const shifts = useDriveList('shiftDefinitions')
  const roles = useDriveList('roles')
  const certs = useDriveList('certifications')
  const records = useDriveList('shifts')
  const [draft, setDraft] = useState(shift)
  const [headcount, setHeadcount] = useState(String(shift.requiredHeadcount ?? 1))
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const exists = shifts.items.some((s) => s.id === shift.id)
  const inUse = records.items.filter((r) => r.shiftDefinitionId === shift.id).length

  const write = async (next: ShiftDefinition[]) => {
    setBusy(true)
    setSaveError(null)
    try {
      await shifts.save(next)
      onDone()
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    // Hours are not edited for now (user's choice): every saved shift gets the standard start and end.
    const clean = { ...draft, name: draft.name.trim(), startTime: SHIFT_START, endTime: SHIFT_END, endsNextDay: endsNextDay(draft), requiredHeadcount: Number(headcount) }
    const err = shiftError(clean, shifts.items, shift.id)
    setError(err)
    if (!err) write(upsert(shifts.items, clean))
  }

  const toggleStandby = (on: boolean) => {
    setDraft({ ...draft, isStandby: on || undefined })
    if (on) setHeadcount(String(STANDBY_HEADCOUNT))
    if (!on && headcount === String(STANDBY_HEADCOUNT)) setHeadcount('1')
  }

  const toggleIn = (field: 'requiredRoleIds' | 'requiredCertificationIds') => (id: string) =>
    setDraft((d) => ({ ...d, [field]: d[field].includes(id) ? d[field].filter((r) => r !== id) : [...d[field], id] }))

  return (
    <>
      <Field label="שם המשמרת">
        <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} />
      </Field>
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={endsNextDay(draft)}
          onChange={(e) => setDraft((d) => ({ ...d, endsNextDay: e.target.checked }))}
          className="size-5 accent-sky-500"
        />
        <span>
          נגמרת למחרת
          <span className="block text-xs text-slate-400">עבודת לילה: נגמרת ב-16:00 ביום שאחרי</span>
        </span>
      </label>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" checked={!!draft.isStandby} onChange={(e) => toggleStandby(e.target.checked)} className="size-5 accent-sky-500" />
        <span>
          משמרת כוננות
          <span className="block text-xs text-slate-400">אנשי הצוות ממתינים בבית לקריאה</span>
        </span>
      </label>
      <Field label="כמה אנשים צריך">
        <input type="number" min={1} inputMode="numeric" value={headcount} onChange={(e) => setHeadcount(e.target.value)} className={inputClass} />
      </Field>
      <div className="space-y-1">
        <span className="text-sm text-slate-300">תפקידים שחייבים להיות במשמרת</span>
        {roles.items.length ? (
          <Chips options={roles.items} selected={draft.requiredRoleIds} onToggle={toggleIn('requiredRoleIds')} />
        ) : (
          <p className="text-sm text-amber-300">עוד אין תפקידים. אפשר להוסיף אותם בלשונית "תפקידים".</p>
        )}
      </div>
      <div className="space-y-1">
        <span className="text-sm text-slate-300">הסמכות שחייבות להיות במשמרת</span>
        {certs.items.length ? (
          <Chips options={certs.items} selected={draft.requiredCertificationIds} onToggle={toggleIn('requiredCertificationIds')} />
        ) : (
          <p className="text-sm text-amber-300">עוד אין הסמכות. אפשר להוסיף אותן בלשונית "הסמכות".</p>
        )}
      </div>
      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={exists ? () => write(shifts.items.filter((s) => s.id !== shift.id)) : undefined}
        deleteWarning={`למחוק את סוג המשמרת "${shift.name}"? אי אפשר לבטל את זה.${inUse ? ` ${countText(inUse, 'משמרת אחת ביומן היא', `משמרות ביומן הן`)} מהסוג הזה: הן יישארו ביומן בלי סוג, כמשמרת יום רגילה.` : ''}`}
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}
