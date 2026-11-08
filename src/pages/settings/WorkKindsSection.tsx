import { tx } from '../../i18n'
import { useState } from 'react'
import { Field, inputClass, Sheet, SheetActions } from '../../components/Sheet'
import { generalRoleId, nameError, newId, staffingFor, staffingText, upsert } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import { useStarterWorkKinds } from '../../lib/data/useStarterWorkKinds'
import { KIND_FIXED } from '../../lib/workKinds'
import type { WorkKind } from '../../types/models'
import { StaffingField } from '../calendar/StaffingField'
import { AddButton, EditMark, EmptyState } from '../workers/common'

// Work kinds and the people each one needs. A job keeps the places it was given, so changing a
// kind here changes only jobs it is picked in from now on.

const EXPLAIN = tx('כל סוג עבודה אומר כמה אנשים הוא צריך ובאיזה תפקיד. כשבוחרים סוג בעבודה, האנשים שלו נוספים לבד ל"כמה אנשים צריך".')

export function WorkKindsSection() {
  useStarterWorkKinds()
  const kinds = useDriveList('workKinds')
  const roles = useDriveList('roles')
  const certs = useDriveList('certifications')
  const [editing, setEditing] = useState<WorkKind | null>(null)
  const fresh = () => setEditing({ id: newId(), name: '', staffing: [{ roleId: generalRoleId(roles.items) }] })

  return (
    <>
      {kinds.items.length === 0 ? (
        <EmptyState text={EXPLAIN} addLabel={tx('הוספת סוג עבודה')} onAdd={fresh} />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-400">{EXPLAIN}</p>
          <ul className="space-y-2">
            {kinds.items.map((k) => (
              <li key={k.id}>
                <button
                  type="button"
                  onClick={() => setEditing(k)}
                  className="relative flex min-h-14 w-full flex-col items-start justify-center gap-0.5 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2 pe-9 text-start"
                >
                  <EditMark />
                  <span className="font-semibold">{k.name}</span>
                  <span className="text-sm text-slate-400">{staffingText(staffingFor(k.staffing, roles.items, certs.items.map((c) => c.id)), roles.items, certs.items)}</span>
                </button>
              </li>
            ))}
          </ul>
          <AddButton label={tx('הוספת סוג עבודה')} onClick={fresh} />
        </>
      )}
      <Sheet
        open={editing !== null}
        title={editing && kinds.items.some((x) => x.id === editing.id) ? tx('עריכת סוג עבודה') : tx('סוג עבודה חדש')}
        onClose={() => setEditing(null)}
        locked={kinds.saving}
      >
        {editing && <KindForm kind={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </>
  )
}

function KindForm({ kind, onDone }: { kind: WorkKind; onDone: () => void }) {
  const kinds = useDriveList('workKinds')
  const roles = useDriveList('roles')
  const certs = useDriveList('certifications')
  const [name, setName] = useState(kind.name)
  const [staffing, setStaffing] = useState(() => staffingFor(kind.staffing, roles.items, certs.items.map((c) => c.id)))
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const exists = kinds.items.some((x) => x.id === kind.id)

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setSaveError(null)
    try {
      await work()
      onDone()
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    const err = nameError(name, kinds.items, kind.id)
    setError(err)
    if (err) return
    // Checked again against the roles as they are now: the form may have opened before they loaded.
    const places = staffingFor(staffing, roles.items, certs.items.map((c) => c.id)).map(({ kindId: _, ...s }) => s)
    run(() => kinds.save(upsert(kinds.items, { ...kind, name: name.trim(), staffing: places, fixed: KIND_FIXED })))
  }

  return (
    <>
      <Field label={tx('שם סוג העבודה')}>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <StaffingField value={staffing} onChange={setStaffing} alt />
      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={exists ? () => run(() => kinds.save(kinds.items.filter((x) => x.id !== kind.id))) : undefined}
        deleteWarning={tx('למחוק את "{name}"? עבודות שכבר נבחר בהן נשארות עם האנשים שהן צריכות.', { name: kind.name })}
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}
