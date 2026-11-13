import { tx } from '../../i18n'
import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Field, inputClass, Sheet, SheetActions } from '../../components/Sheet'
import { nameError, newId, upsert } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import { isFixedField } from '../../lib/vehicles'
import type { VehicleField } from '../../types/models'
import { AddButton, EditMark } from '../workers/common'

// The fields of the vehicle card ("רכבים"). Licence plate and model cannot be deleted: a job
// picks its vehicle by them. A deleted field stops showing; the values typed in it stay in the file.

const KINDS: { id: NonNullable<VehicleField['kind']>; name: string }[] = [
  { id: 'text', name: tx('טקסט') },
  { id: 'number', name: tx('מספר') },
  { id: 'date', name: tx('תאריך') },
]
const kindName = (k: VehicleField['kind']) => KINDS.find((x) => x.id === (k ?? 'text'))!.name

export function VehicleFieldsSection() {
  const fields = useDriveList('vehicleFields')
  const [editing, setEditing] = useState<VehicleField | null>(null)

  return (
    <>
      <p className="text-sm text-slate-400">{tx('מה רושמים על כל רכב בכרטיס הרכב. מספר רישוי ודגם תמיד קיימים, כי לפיהם בוחרים רכב לעבודה.')}</p>
      <ul className="space-y-2">
        {fields.items.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => setEditing(f)}
              className="relative flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2 pe-9 text-start"
            >
              <EditMark />
              <span className="flex items-center gap-2 font-semibold">
                {isFixedField(f.id) && <Lock size={14} aria-label={tx('שדה קבוע')} className="text-slate-400" />}
                {f.name}
              </span>
              <span className="shrink-0 text-sm text-slate-400">{kindName(f.kind)}</span>
            </button>
          </li>
        ))}
      </ul>
      <AddButton label={tx('הוספת שדה')} onClick={() => setEditing({ id: newId(), name: '' })} />
      <Sheet open={editing !== null} title={editing && fields.items.some((f) => f.id === editing.id) ? tx('עריכת שדה') : tx('שדה חדש')} onClose={() => setEditing(null)} locked={fields.saving}>
        {editing && <FieldForm field={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </>
  )
}

function FieldForm({ field, onDone }: { field: VehicleField; onDone: () => void }) {
  const fields = useDriveList('vehicleFields')
  const [name, setName] = useState(field.name)
  const [kind, setKind] = useState<NonNullable<VehicleField['kind']>>(field.kind ?? 'text')
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const exists = fields.items.some((f) => f.id === field.id)
  const fixed = isFixedField(field.id)

  const write = async (next: VehicleField[]) => {
    setBusy(true)
    setSaveError(null)
    try {
      await fields.save(next)
      onDone()
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }
  const save = () => {
    const err = nameError(name, fields.items, field.id)
    setError(err)
    // Plain text needs no kind in the file.
    if (!err) void write(upsert(fields.items, { id: field.id, name: name.trim(), ...(kind !== 'text' && !fixed ? { kind } : {}) }))
  }

  return (
    <>
      <Field label={tx('שם השדה')}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      {!fixed && (
        <Field label={tx('מה כותבים בו')}>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={inputClass}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {fixed && <p className="text-xs text-slate-400">{tx('אפשר לשנות את השם, אבל לא למחוק: לפי השדה הזה בוחרים רכב לעבודה.')}</p>}
      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={exists && !fixed ? () => void write(fields.items.filter((f) => f.id !== field.id)) : undefined}
        deleteWarning={tx('למחוק את השדה "{name}"? הוא לא יופיע יותר בכרטיסי הרכבים.', { name: field.name })}
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}
