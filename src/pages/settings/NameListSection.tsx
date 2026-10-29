import { useState } from 'react'
import { Field, inputClass, Sheet, SheetActions } from '../../components/Sheet'
import { nameError, newId, upsert } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import { renameText, textUsage, usedTexts } from '../../lib/lists'
import type { TextField } from '../../lib/lists'
import { AddButton, EditMark, EmptyState } from '../workers/common'

// Places and kinds of work: names offered under the place and job fields. A shift keeps the text,
// so a rename rewrites the shifts and waiting jobs holding the old text, and a delete leaves them.

type Kind = 'places' | 'jobTypes'

interface Item {
  id: string
  name: string
}

const TEXT: Record<Kind, { field: TextField; explain: string; add: string; edit: string; fresh: string; label: string; one: string }> = {
  places: {
    field: 'location',
    explain: 'מקומות שחוזרים על עצמם. כשממלאים מיקום במשמרת או בעבודה, הם מופיעים מתחת לשדה ואפשר לבחור בלחיצה.',
    add: 'הוספת מקום',
    edit: 'עריכת מקום',
    fresh: 'מקום חדש',
    label: 'שם המקום',
    one: 'המקום',
  },
  jobTypes: {
    field: 'jobDescription',
    explain: 'סוגי עבודה שחוזרים על עצמם. כשממלאים מהות עבודה, הם מופיעים מתחת לשדה ואפשר לבחור בלחיצה.',
    add: 'הוספת סוג עבודה',
    edit: 'עריכת סוג עבודה',
    fresh: 'סוג עבודה חדש',
    label: 'סוג העבודה',
    one: 'סוג העבודה',
  },
}

// A number after a Hebrew prefix letter takes a hyphen: "ב-2 משמרות", "ועבודה אחת".
const withPrefix = (prefix: string, n: number, one: string, many: string) => (n === 1 ? `${prefix}${one}` : `${prefix}${prefix ? '-' : ''}${n} ${many}`)

const usageText = (u: { shifts: number; jobs: number }, prefix = '') =>
  [u.shifts && withPrefix(prefix, u.shifts, 'משמרת אחת', 'משמרות'), u.jobs && withPrefix(u.shifts ? 'ו' : prefix, u.jobs, 'עבודה אחת לשיבוץ', 'עבודות לשיבוץ')]
    .filter(Boolean)
    .join(' ')

export function NameListSection({ kind }: { kind: Kind }) {
  const list = useDriveList(kind)
  const shifts = useDriveList('shifts')
  const jobs = useDriveList('pendingJobs')
  const [editing, setEditing] = useState<Item | null>(null)
  const [starterError, setStarterError] = useState<unknown>(null)
  const t = TEXT[kind]
  // The first fill: what the manager already wrote in shifts and jobs.
  const used = usedTexts(t.field, shifts.items, jobs.items, list.items).slice(0, 30)

  const addUsed = async () => {
    setStarterError(null)
    try {
      await list.save([...list.items, ...used.map((name) => ({ id: newId(), name }))])
    } catch (e) {
      setStarterError(e)
    }
  }

  return (
    <>
      {list.items.length === 0 ? (
        <EmptyState
          text={t.explain}
          addLabel={t.add}
          onAdd={() => setEditing({ id: newId(), name: '' })}
          starterLabel={used.length ? `להתחיל עם מה שכבר כתוב במשמרות: ${used.slice(0, 5).join(', ')}${used.length > 5 ? ' ועוד' : ''}` : undefined}
          onStarter={used.length ? addUsed : undefined}
          starterBusy={list.saving}
          starterError={starterError}
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-400">{t.explain}</p>
          <ul className="space-y-2">
            {list.items.map((item) => {
              const u = textUsage(t.field, item.name, shifts.items, jobs.items)
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(item)}
                    className="relative flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2 pe-9 text-start"
                  >
                    <EditMark />
                    <span className="font-semibold">{item.name}</span>
                    {u.shifts + u.jobs > 0 && <span className="shrink-0 text-sm text-slate-400">{usageText(u)}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
          <AddButton label={t.add} onClick={() => setEditing({ id: newId(), name: '' })} />
        </>
      )}
      <Sheet
        open={editing !== null}
        title={editing && list.items.some((x) => x.id === editing.id) ? t.edit : t.fresh}
        onClose={() => setEditing(null)}
        locked={list.saving || shifts.saving || jobs.saving}
      >
        {editing && <NameForm kind={kind} item={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </>
  )
}

function NameForm({ kind, item, onDone }: { kind: Kind; item: Item; onDone: () => void }) {
  const list = useDriveList(kind)
  const shifts = useDriveList('shifts')
  const jobs = useDriveList('pendingJobs')
  const [name, setName] = useState(item.name)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const t = TEXT[kind]
  const exists = list.items.some((x) => x.id === item.id)
  const u = textUsage(t.field, item.name, shifts.items, jobs.items)
  const used = exists && u.shifts + u.jobs > 0
  const renamed = exists && name.trim() !== item.name

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

  // Shifts and jobs go first: if the list write fails, the old name is still there to retry the rename.
  const save = () => {
    const err = nameError(name, list.items, item.id)
    setError(err)
    if (err) return
    run(async () => {
      if (renamed) {
        const next = renameText(t.field, item.name, name.trim(), shifts.items, jobs.items)
        if (next.shifts !== shifts.items) await shifts.save(next.shifts)
        if (next.jobs !== jobs.items) await jobs.save(next.jobs)
      }
      await list.save(upsert(list.items, { ...item, name: name.trim() }))
    })
  }

  return (
    <>
      <Field label={t.label} hint={renamed && used ? `השם יתעדכן גם ${usageText(u, 'ב')} עם "${item.name}".` : undefined}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={exists ? () => run(() => list.save(list.items.filter((x) => x.id !== item.id))) : undefined}
        deleteWarning={
          used
            ? `${t.one} יימחק מהרשימה בלבד. ${usageText(u, 'ב')} עם "${item.name}" הטקסט יישאר כמו שהוא.`
            : `למחוק את "${item.name}" מהרשימה?`
        }
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}
