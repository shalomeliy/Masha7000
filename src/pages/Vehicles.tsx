import { tx } from '../i18n'
import { useState } from 'react'
import { CheckSquare, Loader2, Plus, Search, Square, Trash2 } from 'lucide-react'
import { DriveError } from '../components/DriveError'
import { Field, goToField, inputClass, Sheet, SheetActions } from '../components/Sheet'
import { fullName, isActive, newId, upsert } from '../lib/catalog'
import { useDriveList } from '../lib/data/useDriveList'
import { todayIso } from '../lib/dates'
import { showDate } from '../lib/shifts'
import {
  cleanVehicle,
  DRIVER,
  hasSamples,
  SAMPLE_COUNT,
  PLATE,
  plateOf,
  sampleVehicles,
  shownValue,
  TYPE,
  typeOf,
  vehicleError,
  vehicleExpiries,
  worstExpiry,
} from '../lib/vehicles'
import type { VehicleExpiry } from '../lib/vehicles'
import { useAuth } from '../store/auth'
import type { Vehicle } from '../types/models'
import { EditMark, EmptyState } from './workers/common'

// "רכבים" (the user's request, 2026-11-13): the vehicle inventory. A tap opens the vehicle's card;
// "בחירה" picks several at once, to delete them together. Which fields a card has is edited in
// Settings ("שדות בכרטיס רכב").

const blank = (): Vehicle => ({ id: newId(), values: {} })

export function Vehicles() {
  const vehicles = useDriveList('vehicles')
  const fields = useDriveList('vehicleFields')
  const workers = useDriveList('workers')
  const lists = [vehicles, fields, workers]
  const loading = lists.some((l) => l.query.isPending)
  const failed = lists.find((l) => l.query.isError)
  const isOwner = useAuth().who?.isOwner === true || import.meta.env.DEV
  const today = todayIso()
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [query, setQuery] = useState('')

  const q = query.trim().toLocaleLowerCase()
  const shown = vehicles.items
    .filter((v) => !q || Object.keys(v.values).some((k) => shownValue(v, k, workers.items).toLocaleLowerCase().includes(q)))
    .sort((a, b) => typeOf(a).localeCompare(typeOf(b), 'he') || plateOf(a).localeCompare(plateOf(b), 'he'))
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const stopSelecting = () => (setSelecting(false), setSelected([]), setConfirming(false), setSaveError(null))
  const allShown = shown.length > 0 && shown.every((v) => selected.includes(v.id))

  const removeSelected = async () => {
    setSaveError(null)
    try {
      await vehicles.save(vehicles.items.filter((v) => !selected.includes(v.id)))
      stopSelecting()
    } catch (e) {
      setSaveError(e)
    }
  }

  // The owner adds ten example vehicles once, to see the expiry warnings (the user's request, 2026-11-14).
  const [seedError, setSeedError] = useState<unknown>(null)
  const addSamples = async () => {
    setSeedError(null)
    try {
      await vehicles.save([...vehicles.items, ...sampleVehicles(today, vehicles.items, workers.items.filter(isActive).map((w) => w.id))])
    } catch (e) {
      setSeedError(e)
    }
  }
  const seed =
    isOwner && !hasSamples(vehicles.items) ? (
      <div className="space-y-2 rounded-2xl border border-dashed border-slate-700 p-3">
        <button type="button" disabled={vehicles.saving} onClick={addSamples} className="min-h-11 w-full rounded-xl border border-sky-500/60 text-sm font-semibold text-sky-300 disabled:opacity-50">
          {vehicles.saving ? tx('מוסיף...') : tx('הוספת {n} רכבים לדוגמה', { n: SAMPLE_COUNT })}
        </button>
        <p className="text-xs text-slate-400">{tx('רכבים עם תוקף טסט וביטוח שונים, כדי לראות את ההתראות. אפשר למחוק אותם אחר כך ב"בחירה".')}</p>
        {seedError != null && <DriveError error={seedError} action="save" />}
      </div>
    ) : null

  // Up to three short values under the plate: type, make and model, the driver.
  const extra = fields.items.filter((f) => f.id !== PLATE && f.id !== TYPE && f.kind !== 'date').slice(0, 3)

  return (
    <section className="space-y-4 px-4 pt-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{tx('רכבים')}</h1>
        {!loading && !failed && (
          <button
            type="button"
            onClick={() => setEditing(blank())}
            aria-label={tx('הוספת רכב')}
            className="flex min-h-9 shrink-0 items-center gap-1 rounded-lg bg-sky-600 px-2.5 text-sm font-semibold text-white active:bg-sky-700"
          >
            {tx('הוסף')}
            <Plus size={16} aria-hidden />
          </button>
        )}
      </div>

      {failed ? (
        <DriveError error={failed.query.error} action="load" onRetry={() => lists.forEach((l) => l.query.isError && l.query.refetch())} />
      ) : loading ? (
        <p className="flex items-center gap-2 text-slate-400">
          <Loader2 className="animate-spin" size={18} aria-hidden />
          {tx('טוען מגוגל דרייב...')}
        </p>
      ) : vehicles.items.length === 0 ? (
        <>
          <EmptyState text={tx('עוד אין רכבים. מוסיפים כל רכב פעם אחת, ואז בוחרים אותו בעבודה ביומן.')} addLabel={tx('הוספת רכב')} onAdd={() => setEditing(blank())} />
          {seed}
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <label className="relative flex-1">
              <Search size={18} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tx('חיפוש רכב')}
                aria-label={tx('חיפוש רכב')}
                className={`${inputClass} ps-10`}
              />
            </label>
            <button
              type="button"
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              aria-pressed={selecting}
              className={`min-h-11 shrink-0 rounded-xl border px-4 text-sm font-medium ${selecting ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300'}`}
            >
              {selecting ? tx('סיום בחירה') : tx('בחירה')}
            </button>
          </div>

          {selecting && (
            <div className="space-y-2 rounded-2xl border border-slate-700 bg-slate-900 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate-300">{selected.length === 1 ? tx('נבחר רכב אחד') : tx('נבחרו {n} רכבים', { n: selected.length })}</span>
                <button type="button" onClick={() => setSelected(allShown ? [] : shown.map((v) => v.id))} className="min-h-11 px-2 text-sm text-sky-300">
                  {allShown ? tx('ניקוי הבחירה') : tx('בחירת הכל')}
                </button>
              </div>
              {confirming ? (
                <div className="space-y-2">
                  <p className="text-sm text-red-200">
                    {selected.length === 1 ? tx('למחוק את הרכב שנבחר? עבודות שהוא רשום בהן יראו "רכב שנמחק".') : tx('למחוק {n} רכבים? עבודות שהם רשומים בהן יראו "רכב שנמחק".', { n: selected.length })}
                  </p>
                  {saveError != null && <DriveError error={saveError} action="save" />}
                  <div className="flex gap-2">
                    <button type="button" disabled={vehicles.saving} onClick={removeSelected} className="min-h-11 flex-1 rounded-xl bg-red-500 font-semibold text-slate-950 disabled:opacity-50">
                      {vehicles.saving ? tx('מוחק...') : tx('כן, למחוק')}
                    </button>
                    <button type="button" disabled={vehicles.saving} onClick={() => setConfirming(false)} className="min-h-11 flex-1 rounded-xl border border-slate-700 text-slate-300">
                      {tx('לא')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!selected.length}
                  onClick={() => setConfirming(true)}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-500/60 text-sm font-semibold text-red-300 disabled:opacity-40"
                >
                  <Trash2 size={18} aria-hidden />
                  {tx('מחיקת הנבחרים')}
                </button>
              )}
            </div>
          )}

          {shown.length === 0 ? (
            <p className="text-sm text-slate-400">{tx('אין רכב שמתאים לחיפוש.')}</p>
          ) : (
            <ul className="space-y-2">
              {shown.map((v) => {
                const on = selected.includes(v.id)
                const warnings = vehicleExpiries(v, fields.items, today)
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => (selecting ? toggle(v.id) : setEditing(v))}
                      aria-pressed={selecting ? on : undefined}
                      className={`relative flex w-full items-start gap-3 rounded-2xl border p-4 text-start ${on ? 'border-sky-500 bg-sky-500/10' : 'border-slate-800 bg-slate-900'} ${selecting ? '' : 'pe-9'}`}
                    >
                      {selecting ? (
                        on ? <CheckSquare size={22} aria-hidden className="mt-0.5 shrink-0 text-sky-300" /> : <Square size={22} aria-hidden className="mt-0.5 shrink-0 text-slate-500" />
                      ) : (
                        <EditMark />
                      )}
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <ExpiryMark list={warnings} />
                          <span dir="ltr" className="font-mono text-lg font-semibold">{plateOf(v)}</span>
                          {typeOf(v) && <span className="rounded-full border border-slate-600 px-2 py-0.5 text-xs font-semibold text-slate-200">{typeOf(v)}</span>}
                        </span>
                        {extra.some((f) => v.values[f.id]) && (
                          <span className="block break-words text-sm text-slate-300">{extra.map((f) => shownValue(v, f.id, workers.items)).filter(Boolean).join(' · ')}</span>
                        )}
                        {warnings.map((w) => (
                          <span key={w.fieldId} className={`block text-xs ${TONE[w.state]}`}>{expiryText(w)}</span>
                        ))}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {seed}
        </>
      )}

      <Sheet open={editing !== null} title={editing && vehicles.items.some((v) => v.id === editing.id) ? tx('כרטיס רכב') : tx('רכב חדש')} onClose={() => setEditing(null)} locked={vehicles.saving}>
        {editing && <VehicleForm vehicle={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </section>
  )
}

const TONE = { soon: 'text-orange-300', expired: 'text-red-300', missing: 'text-red-300' } as const
// '!' wins over the input's own border and text colors.
const FIELD_TONE = { soon: 'border-orange-400! text-orange-200!', expired: 'border-red-500! text-red-200!', missing: 'border-red-500!' } as const

/** "תוקף טסט: פג ב-1.11.2026", "תוקף ביטוח: נגמר ב-23.11.2026", "תוקף טסט: חסר". */
function expiryText(e: VehicleExpiry): string {
  if (e.state === 'missing') return tx('{name}: חסר', { name: e.name })
  const v = `${showDate(e.date!)}.${e.date!.slice(0, 4)}`
  return e.state === 'expired' ? tx('{name}: פג ב-{v}', { name: e.name, v }) : tx('{name}: נגמר ב-{v}', { name: e.name, v })
}

/** One "!" by the plate: red when a date passed or is missing, orange when one ends within 30 days. */
function ExpiryMark({ list }: { list: VehicleExpiry[] }) {
  const worst = worstExpiry(list)
  if (!worst) return null
  const label = list.map(expiryText).join(', ')
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${worst === 'red' ? 'bg-red-600 text-white' : 'bg-orange-500 text-slate-950'}`}
    >
      !
    </span>
  )
}

const fieldDomId = (id: string) => `vehicle-field-${id}`

function VehicleForm({ vehicle, onDone }: { vehicle: Vehicle; onDone: () => void }) {
  const vehicles = useDriveList('vehicles')
  const fields = useDriveList('vehicleFields')
  const workers = useDriveList('workers')
  const [draft, setDraft] = useState(vehicle)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const exists = vehicles.items.some((v) => v.id === vehicle.id)
  const types = [...new Set(vehicles.items.map(typeOf).filter(Boolean))]
  const setValue = (id: string, value: string) => setDraft((d) => ({ ...d, values: { ...d.values, [id]: value } }))
  // The notes follow what is typed: fixing the date makes its note and color go away.
  const expiries = vehicleExpiries(draft, fields.items, todayIso())
  const expiryOf = (id: string) => expiries.find((e) => e.fieldId === id)
  const drivers = workers.items.filter((w) => isActive(w) || w.id === draft.values[DRIVER]).sort((a, b) => fullName(a).localeCompare(fullName(b), 'he'))
  const typedDriver = draft.values[DRIVER] && !workers.items.some((w) => w.id === draft.values[DRIVER]) ? draft.values[DRIVER] : ''

  const write = async (next: Vehicle[]) => {
    setBusy(true)
    setSaveError(null)
    try {
      await vehicles.save(next)
      onDone()
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }
  const save = () => {
    const clean = cleanVehicle(draft)
    const err = vehicleError(clean, vehicles.items)
    setError(err)
    if (!err) void write(upsert(vehicles.items, clean))
  }

  return (
    <>
      {exists && expiries.length > 0 && (
        // A tap takes the manager to the date (the same as a form's error note).
        <div className="space-y-1">
          {expiries.map((e) => (
            <button
              key={e.fieldId}
              type="button"
              onClick={(ev) => goToField(ev.currentTarget, expiryText(e), `#${fieldDomId(e.fieldId)}`)}
              className={`flex min-h-9 w-full items-center gap-2 text-start text-sm underline underline-offset-4 ${TONE[e.state]}`}
            >
              <ExpiryMark list={[e]} />
              {expiryText(e)}
            </button>
          ))}
        </div>
      )}
      {fields.items.map((f, i) => {
        const warn = expiryOf(f.id)
        const tone = warn ? FIELD_TONE[warn.state] : ''
        return (
          <Field key={f.id} label={f.name}>
            {f.id === DRIVER ? (
              <select id={fieldDomId(f.id)} value={draft.values[f.id] ?? ''} onChange={(e) => setValue(f.id, e.target.value)} className={inputClass}>
                <option value="">{tx('בלי נהג קבוע')}</option>
                {typedDriver && <option value={typedDriver}>{typedDriver}</option>}
                {drivers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {fullName(w)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={fieldDomId(f.id)}
                autoFocus={i === 0 && !exists}
                type={f.kind === 'date' ? 'date' : 'text'}
                inputMode={f.kind === 'number' ? 'numeric' : undefined}
                dir={f.id === PLATE ? 'ltr' : undefined}
                list={f.id === TYPE ? 'vehicle-types' : undefined}
                aria-invalid={warn ? true : undefined}
                value={draft.values[f.id] ?? ''}
                onChange={(e) => setValue(f.id, e.target.value)}
                className={`${inputClass} ${tone}`}
              />
            )}
            {warn && <span className={`block text-xs ${TONE[warn.state]}`}>{expiryText(warn)}</span>}
          </Field>
        )
      })}
      <datalist id="vehicle-types">
        {types.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={exists ? () => void write(vehicles.items.filter((v) => v.id !== vehicle.id)) : undefined}
        deleteWarning={tx('למחוק את הרכב? עבודות שהוא רשום בהן יראו "רכב שנמחק".')}
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}
