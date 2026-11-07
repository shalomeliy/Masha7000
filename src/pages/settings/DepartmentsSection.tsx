import { tx } from '../../i18n'
import { useState } from 'react'
import { Field, inputClass, Sheet, SheetActions } from '../../components/Sheet'
import { countText, nameError, newId, upsert } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import type { Department } from '../../types/models'
import { AddButton, EditMark, EmptyState } from '../workers/common'

// The departments a worker can belong to. A worker holds the department's id, so a rename shows on
// every worker at once, and a delete clears it from the workers who had it.

const EXPLAIN = tx('המחלקות שעובד יכול להשתייך אליהן. בוחרים מחלקה בטופס העובד.')

export function DepartmentsSection() {
  const list = useDriveList('departments')
  const workers = useDriveList('workers')
  const [editing, setEditing] = useState<Department | null>(null)
  const add = () => setEditing({ id: newId(), name: '' })

  return (
    <>
      {list.items.length === 0 ? (
        <EmptyState text={EXPLAIN} addLabel={tx('הוספת מחלקה')} onAdd={add} />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-400">{EXPLAIN}</p>
          <ul className="space-y-2">
            {list.items.map((item) => {
              const n = workers.items.filter((w) => w.departmentId === item.id).length
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(item)}
                    className="relative flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2 pe-9 text-start"
                  >
                    <EditMark />
                    <span className="font-semibold">{item.name}</span>
                    {n > 0 && <span className="shrink-0 text-sm text-slate-400">{countText(n, tx('עובד אחד'), tx('עובדים'))}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
          <AddButton label={tx('הוספת מחלקה')} onClick={add} />
        </>
      )}
      <Sheet
        open={editing !== null}
        title={editing && list.items.some((x) => x.id === editing.id) ? tx('עריכת מחלקה') : tx('מחלקה חדשה')}
        onClose={() => setEditing(null)}
        locked={list.saving || workers.saving}
      >
        {editing && <DepartmentForm item={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </>
  )
}

function DepartmentForm({ item, onDone }: { item: Department; onDone: () => void }) {
  const list = useDriveList('departments')
  const workers = useDriveList('workers')
  const [name, setName] = useState(item.name)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const exists = list.items.some((x) => x.id === item.id)
  const used = workers.items.filter((w) => w.departmentId === item.id).length

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
    const err = nameError(name, list.items, item.id)
    setError(err)
    if (!err) run(() => list.save(upsert(list.items, { ...item, name: name.trim() })))
  }

  // Workers go first: if the list write fails, the department is still listed and the delete can be retried.
  const remove = () =>
    run(async () => {
      if (used) await workers.save(workers.items.map((w) => (w.departmentId === item.id ? { ...w, departmentId: undefined } : w)))
      await list.save(list.items.filter((x) => x.id !== item.id))
    })

  return (
    <>
      <Field label={tx('שם המחלקה')}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={exists ? remove : undefined}
        deleteWarning={
          used
            ? tx('{v} למחלקה "{name}". אחרי המחיקה {v2} בלי מחלקה.', { v: used === 1 ? tx('עובד אחד שייך') : tx('{used} עובדים שייכים', { used }), name: item.name, v2: used === 1 ? tx('הוא יישאר') : tx('הם יישארו') })
            : tx('למחוק את "{name}" מהרשימה?', { name: item.name })
        }
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}
