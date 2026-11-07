import { tx } from '../../i18n'
import { useState } from 'react'
import { Field, inputClass, Sheet, SheetActions } from '../../components/Sheet'
import { countText, isGeneralRole, nameError, newId, removeTagReferences, STARTER_CERTIFICATIONS, STARTER_ROLES, tagUsage, upsert } from '../../lib/catalog'
import type { TagKind } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import { AddButton, EditMark, EmptyState } from './common'

// Roles and certifications behave the same: a named list that workers hold and shift types require.
// The one exception is the role "כללי": every worker holds it, and it cannot be renamed or deleted.

interface Tag {
  id: string
  name: string
}

const TEXT: Record<TagKind, { one: string; linked: string; it: string; add: string; edit: string; fresh: string; field: string; explain: string; starter: string[] }> = {
  roles: {
    one: tx('התפקיד'),
    linked: tx('משויך'),
    it: tx('אותו'),
    add: tx('הוספת תפקיד'),
    edit: tx('עריכת תפקיד'),
    fresh: tx('תפקיד חדש'),
    field: tx('שם התפקיד'),
    explain: tx('תפקיד הוא מה שהעובד יודע לעשות, למשל טפסן או חשמלאי. לכל עובד אפשר לסמן כמה תפקידים שרוצים.'),
    starter: STARTER_ROLES.filter((name) => !isGeneralRole({ name })), // "כללי" is always there
  },
  certifications: {
    one: tx('ההסמכה'),
    linked: tx('משויכת'),
    it: tx('אותה'),
    add: tx('הוספת הסמכה'),
    edit: tx('עריכת הסמכה'),
    fresh: tx('הסמכה חדשה'),
    field: tx('שם ההסמכה'),
    explain: tx('הסמכה היא אישור שיש לעובד, למשל עבודה בגובה 40 מטר. לכל עובד אפשר לסמן כמה הסמכות שרוצים.'),
    starter: STARTER_CERTIFICATIONS,
  },
}

export function TagSection({ kind }: { kind: TagKind }) {
  const tags = useDriveList(kind)
  const workers = useDriveList('workers')
  const shifts = useDriveList('shiftDefinitions')
  const [editing, setEditing] = useState<Tag | null>(null)
  const [starterError, setStarterError] = useState<unknown>(null)
  const t = TEXT[kind]
  const isFixed = (tag: Tag) => kind === 'roles' && isGeneralRole(tag)

  const addStarter = async () => {
    setStarterError(null)
    try {
      await tags.save([...tags.items, ...t.starter.map((name) => ({ id: newId(), name }))])
    } catch (e) {
      setStarterError(e)
    }
  }

  return (
    <>
      {tags.items.every(isFixed) ? (
        <EmptyState
          text={t.explain}
          addLabel={t.add}
          onAdd={() => setEditing({ id: newId(), name: '' })}
          starterLabel={tx('להתחיל עם: {v}', { v: t.starter.join(', ') })}
          onStarter={addStarter}
          starterBusy={tags.saving}
          starterError={starterError}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {tags.items.map((tag) => {
              const u = tagUsage(kind, tag.id, workers.items, shifts.items)
              if (isFixed(tag))
                return (
                  <li key={tag.id} className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-2">
                    <span>
                      <span className="block font-semibold">{tag.name}</span>
                      <span className="block text-xs text-slate-400">{tx('כל העובדים, קבוע')}</span>
                    </span>
                    <span className="shrink-0 text-sm text-slate-400">{countText(workers.items.length, tx('עובד אחד'), tx('עובדים'))}</span>
                  </li>
                )
              return (
                <li key={tag.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(tag)}
                    className="relative flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2 pe-9 text-start"
                  >
                    <EditMark />
                    <span className="font-semibold">{tag.name}</span>
                    <span className="shrink-0 text-sm text-slate-400">{countText(u.workers, tx('עובד אחד'), tx('עובדים'))}</span>
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
        title={editing && tags.items.some((x) => x.id === editing.id) ? t.edit : t.fresh}
        onClose={() => setEditing(null)}
        locked={tags.saving || workers.saving || shifts.saving}
      >
        {editing && <TagForm kind={kind} tag={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </>
  )
}

// "לעובד אחד" / "ל-3 עובדים": a number after a Hebrew prefix letter takes a hyphen.
const toCount = (n: number, one: string, many: string) => (n === 1 ? tx('ל{one}', { one }) : tx('ל-{n} {many}', { n, many }))

function TagForm({ kind, tag, onDone }: { kind: TagKind; tag: Tag; onDone: () => void }) {
  const tags = useDriveList(kind)
  const workers = useDriveList('workers')
  const shifts = useDriveList('shiftDefinitions')
  const [name, setName] = useState(tag.name)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const t = TEXT[kind]
  const exists = tags.items.some((x) => x.id === tag.id)
  const u = tagUsage(kind, tag.id, workers.items, shifts.items)

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
    const err = nameError(name, tags.items, tag.id)
    setError(err)
    if (!err) run(() => tags.save(upsert(tags.items, { ...tag, name: name.trim() })))
  }

  // References go first: if a later write fails, the tag is still listed and the delete can be retried.
  const remove = () =>
    run(async () => {
      const next = removeTagReferences(kind, tag.id, workers.items, shifts.items)
      if (next.workers !== workers.items) await workers.save(next.workers)
      if (next.shifts !== shifts.items) await shifts.save(next.shifts)
      await tags.save(tags.items.filter((x) => x.id !== tag.id))
    })

  // "ממנו" for one worker, "ממנה" for one shift, "מהם" for more.
  const fromThem = u.workers + u.shifts > 1 ? tx('מהם') : u.workers ? tx('ממנו') : tx('ממנה')
  const parts = [u.workers && toCount(u.workers, tx('עובד אחד'), tx('עובדים')), u.shifts && toCount(u.shifts, tx('עבודה אחת'), tx('עבודות'))].filter(Boolean)

  return (
    <>
      <Field label={t.field}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={exists ? remove : undefined}
        deleteWarning={parts.length ? tx('{one} {linked} {v}. המחיקה תסיר {it} גם {fromThem}.', { one: t.one, linked: t.linked, v: parts.join(tx(' ו')), it: t.it, fromThem }) : undefined}
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}
