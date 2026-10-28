import { useState } from 'react'
import { CalendarX, Filter, Phone, X } from 'lucide-react'
import { Chips, Field, inputClass, Sheet, SheetActions } from '../../components/Sheet'
import {
  countText,
  filterWorkers,
  fullName,
  GENERAL_ROLE_NAME,
  generalRoleId,
  isGeneralRole,
  isIsraeliMobile,
  newId,
  tagNames,
  telHref,
  upsert,
} from '../../lib/catalog'
import { constraintText, isOver } from '../../lib/constraints'
import { useDriveList } from '../../lib/data/useDriveList'
import { todayIso } from '../../lib/dates'
import { DateField } from '../../components/DateField'
import type { Worker } from '../../types/models'
import { AddButton, EditMark, EmptyState } from './common'
import { ConstraintsField } from './ConstraintsField'
import { RequestSheet } from './RequestSheet'

const blankWorker = (): Worker => ({ id: newId(), firstName: '', lastName: '', roleIds: [], certificationIds: [], constraints: [] })

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

export function WorkersSection() {
  const workers = useDriveList('workers')
  const roles = useDriveList('roles')
  const certs = useDriveList('certifications')
  const [editing, setEditing] = useState<Worker | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [roleFilter, setRoleFilter] = useState<string[]>([])
  const [certFilter, setCertFilter] = useState<string[]>([])
  const [requesting, setRequesting] = useState(false)

  const filtering = roleFilter.length + certFilter.length > 0
  const shown = filterWorkers(workers.items, roleFilter, certFilter, generalRoleId(roles.items)).sort((a, b) => fullName(a).localeCompare(fullName(b), 'he'))
  const filterNames = [...tagNames(roleFilter, roles.items), ...tagNames(certFilter, certs.items)]

  if (workers.items.length === 0) {
    return (
      <>
        <EmptyState
          text="כאן נמצאת רשימת העובדים שלך. לכל עובד מסמנים את התפקידים וההסמכות שלו, ואז אפשר לחפש לפיהם."
          addLabel="הוספת עובד"
          onAdd={() => setEditing(blankWorker())}
        />
        <WorkerSheet editing={editing} onClose={() => setEditing(null)} />
      </>
    )
  }

  return (
    <>
      <div className="mb-3 space-y-2">
        <button
          type="button"
          onClick={() => setRequesting(true)}
          className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-emerald-500/50 px-3 text-start text-sm text-emerald-300"
        >
          <CalendarX size={16} aria-hidden className="shrink-0" />
          בקשת אילוצים מהעובדים בוואטסאפ
        </button>
        <button
          type="button"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen(!filterOpen)}
          className={`flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 text-start text-sm ${
            filtering ? 'border-sky-500 text-sky-300' : 'border-slate-700 text-slate-300'
          }`}
        >
          <Filter size={16} aria-hidden className="shrink-0" />
          {filtering ? `מסנן לפי: ${filterNames.join(', ')}` : 'חיפוש עובדים לפי תפקיד או הסמכה'}
        </button>
        {filterOpen && (
          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
            <p className="text-xs text-slate-400">יוצגו רק עובדים שיש להם את כל מה שסימנת.</p>
            {roles.items.length > 0 && (
              <div className="space-y-1">
                <span className="text-sm text-slate-300">תפקידים</span>
                <Chips options={roles.items} selected={roleFilter} onToggle={(id) => setRoleFilter((f) => toggle(f, id))} />
              </div>
            )}
            {certs.items.length > 0 && (
              <div className="space-y-1">
                <span className="text-sm text-slate-300">הסמכות</span>
                <Chips options={certs.items} selected={certFilter} onToggle={(id) => setCertFilter((f) => toggle(f, id))} />
              </div>
            )}
            {filtering && (
              <button
                type="button"
                onClick={() => {
                  setRoleFilter([])
                  setCertFilter([])
                }}
                className="flex min-h-11 items-center gap-1 text-sm text-slate-300"
              >
                <X size={16} aria-hidden />
                ניקוי הסינון
              </button>
            )}
          </div>
        )}
      </div>

      <p className="mb-2 text-sm text-slate-400" aria-live="polite">
        {filtering
          ? `${countText(shown.length, 'עובד אחד מתאים', 'עובדים מתאימים')} מתוך ${workers.items.length}`
          : countText(workers.items.length, 'עובד אחד', 'עובדים')}
      </p>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">אין עובד שיש לו את כל מה שסימנת.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((w) => (
            <li key={w.id}>
              <WorkerCard worker={w} onOpen={() => setEditing(w)} />
            </li>
          ))}
        </ul>
      )}
      <AddButton label="הוספת עובד" onClick={() => setEditing(blankWorker())} />
      <WorkerSheet editing={editing} onClose={() => setEditing(null)} />
      <RequestSheet open={requesting} onClose={() => setRequesting(false)} />
    </>
  )
}

function WorkerCard({ worker: w, onOpen }: { worker: Worker; onOpen: () => void }) {
  const roles = useDriveList('roles')
  const certs = useDriveList('certifications')
  // Every worker is "כללי"; it is shown only when they hold no other role, so the card is never empty.
  const specific = tagNames(w.roleIds, roles.items.filter((r) => !isGeneralRole(r)))
  const roleList = specific.length ? specific : [GENERAL_ROLE_NAME]
  const certList = tagNames(w.certificationIds, certs.items)
  const today = todayIso()
  const active = w.constraints.filter((c) => !isOver(c, today))

  const dial = telHref(w.mobilePhone)

  return (
    <div className="flex items-stretch rounded-2xl border border-slate-800 bg-slate-900">
      <button type="button" onClick={onOpen} className="relative min-w-0 flex-1 space-y-2 p-4 pe-9 text-start">
        <EditMark />
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{fullName(w)}</span>
          {w.mobilePhone && (
            <span dir="ltr" className="text-sm text-slate-400">
              {w.mobilePhone}
            </span>
          )}
        </span>
        <span className="flex flex-wrap gap-1">
          {roleList.map((n) => (
            <span key={n} className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-200">
              {n}
            </span>
          ))}
          {certList.map((n) => (
            <span key={n} className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-200">
              {n}
            </span>
          ))}
        </span>
        {active.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {active.slice(0, 2).map((c) => (
              <span key={c.id} className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200">
                {constraintText(c)}
              </span>
            ))}
            {active.length > 2 && <span className="px-1 text-xs text-amber-200">ועוד {active.length - 2}</span>}
          </span>
        )}
      </button>
      {dial && (
        <a href={dial} aria-label={`חיוג אל ${fullName(w)}`} className="flex w-14 shrink-0 items-center justify-center border-s border-slate-800 text-emerald-400">
          <Phone size={22} aria-hidden />
        </a>
      )}
    </div>
  )
}

function WorkerSheet({ editing, onClose }: { editing: Worker | null; onClose: () => void }) {
  const workers = useDriveList('workers')
  return (
    <Sheet
      open={editing !== null}
      title={editing && workers.items.some((w) => w.id === editing.id) ? 'עריכת עובד' : 'עובד חדש'}
      onClose={onClose}
      locked={workers.saving}
    >
      {editing && <WorkerForm worker={editing} onDone={onClose} />}
    </Sheet>
  )
}

const PHONES = [
  ['mobilePhone', 'טלפון נייד (חובה)'],
  ['homePhone', 'טלפון בבית'],
  ['emergencyPhone1', 'טלפון חירום 1'],
  ['emergencyPhone2', 'טלפון חירום 2'],
] as const

const OPTIONAL_TEXT = ['birthDate', 'address', 'notes', ...PHONES.map(([f]) => f)] as const
type TextField = 'firstName' | 'lastName' | (typeof OPTIONAL_TEXT)[number]

function WorkerForm({ worker, onDone }: { worker: Worker; onDone: () => void }) {
  const workers = useDriveList('workers')
  const roles = useDriveList('roles')
  const certs = useDriveList('certifications')
  const [draft, setDraft] = useState(worker)
  const [error, setError] = useState<string | null>(null)
  const [birthDateValid, setBirthDateValid] = useState(true)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const exists = workers.items.some((w) => w.id === worker.id)
  const specificRoles = roles.items.filter((r) => !isGeneralRole(r))

  const set = (field: TextField) => (e: { target: { value: string } }) => {
    const value = e.target.value
    setDraft((d) => ({ ...d, [field]: value }))
  }

  const write = async (next: Worker[]) => {
    setBusy(true)
    setSaveError(null)
    try {
      await workers.save(next)
      onDone()
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    // Names are not unique on purpose: two workers may share a name.
    const err = !draft.firstName.trim()
      ? 'צריך למלא שם פרטי'
      : !draft.lastName.trim()
        ? 'צריך למלא שם משפחה'
        : !draft.mobilePhone?.trim()
          ? 'צריך למלא טלפון נייד'
          : !isIsraeliMobile(draft.mobilePhone)
            ? 'הטלפון הנייד לא תקין. צריך 10 ספרות שמתחילות ב-05, למשל 050-1234567'
            : !birthDateValid
              ? 'תאריך הלידה לא תקין'
              : null
    setError(err)
    if (err) return
    const clean: Worker = { ...draft, firstName: draft.firstName.trim(), lastName: draft.lastName.trim() }
    for (const f of OPTIONAL_TEXT) clean[f] = clean[f]?.trim() || undefined
    write(upsert(workers.items, clean))
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="שם פרטי (חובה)">
          <input autoFocus value={draft.firstName} onChange={set('firstName')} className={inputClass} />
        </Field>
        <Field label="שם משפחה (חובה)">
          <input value={draft.lastName} onChange={set('lastName')} className={inputClass} />
        </Field>
      </div>

      <div className="space-y-1">
        <span className="text-sm text-slate-300">תפקידים</span>
        <p className="text-xs text-slate-400">כל עובד הוא גם "כללי", בלי לסמן.</p>
        {specificRoles.length ? (
          <Chips options={specificRoles} selected={draft.roleIds} onToggle={(id) => setDraft((d) => ({ ...d, roleIds: toggle(d.roleIds, id) }))} />
        ) : (
          <p className="text-sm text-amber-300">עוד אין תפקידים מלבד "כללי". אפשר להוסיף אותם בלשונית "תפקידים".</p>
        )}
      </div>
      <div className="space-y-1">
        <span className="text-sm text-slate-300">הסמכות</span>
        {certs.items.length ? (
          <Chips
            options={certs.items}
            selected={draft.certificationIds}
            onToggle={(id) => setDraft((d) => ({ ...d, certificationIds: toggle(d.certificationIds, id) }))}
          />
        ) : (
          <p className="text-sm text-amber-300">עוד אין הסמכות. אפשר להוסיף אותן בלשונית "הסמכות".</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {PHONES.map(([field, label]) => {
          const dial = telHref(draft[field])
          return (
            <Field key={field} label={label}>
              <span className="flex gap-1">
                <input type="tel" dir="ltr" inputMode="tel" value={draft[field] ?? ''} onChange={set(field)} className={`${inputClass} min-w-0 text-right`} />
                {/* Always shown so every phone field visibly has a call button; inactive until a number is typed. */}
                {dial ? (
                  <a href={dial} aria-label={`חיוג: ${label}`} className="flex w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
                    <Phone size={18} aria-hidden />
                  </a>
                ) : (
                  <span aria-hidden className="flex w-11 shrink-0 items-center justify-center rounded-xl bg-slate-800/60 text-slate-600">
                    <Phone size={18} />
                  </span>
                )}
              </span>
            </Field>
          )
        })}
      </div>
      <DateField
        label="תאריך לידה"
        value={draft.birthDate ?? ''}
        min="1900-01-01"
        max={todayIso()}
        onChange={(birthDate, valid) => {
          setDraft((d) => ({ ...d, birthDate }))
          setBirthDateValid(valid)
        }}
      />
      <ConstraintsField
        value={draft.constraints}
        onChange={(constraints) => setDraft((d) => ({ ...d, constraints }))}
        onNotes={(text) => setDraft((d) => ({ ...d, notes: [d.notes?.trim(), text].filter(Boolean).join('\n') }))}
      />
      <Field label="כתובת">
        <input value={draft.address ?? ''} onChange={set('address')} className={inputClass} />
      </Field>
      <Field label="הערות">
        <textarea rows={2} value={draft.notes ?? ''} onChange={set('notes')} className={inputClass} />
      </Field>

      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={exists ? () => write(workers.items.filter((w) => w.id !== worker.id)) : undefined}
        deleteWarning={`למחוק את ${fullName(worker)}? אי אפשר לבטל את זה.`}
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}
