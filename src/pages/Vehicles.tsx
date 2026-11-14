import { tx } from '../i18n'
import { useState } from 'react'
import { CheckSquare, Loader2, Plus, Search, Square, Trash2 } from 'lucide-react'
import { DriveError } from '../components/DriveError'
import { Field, inputClass, Sheet, SheetActions } from '../components/Sheet'
import { newId, upsert } from '../lib/catalog'
import { useDriveList } from '../lib/data/useDriveList'
import { cleanVehicle, hasSamples, MAKE, makeOf, MODEL, modelOf, PLATE, plateOf, SAMPLE_COUNT, sampleVehicles, VEHICLE_FIELDS, vehicleError } from '../lib/vehicles'
import { useAuth } from '../store/auth'
import type { Vehicle } from '../types/models'
import { EditMark, EmptyState } from './workers/common'

// "רכבים" (the user's request, 2026-11-13): the vehicle inventory. A tap opens the vehicle's card;
// "בחירה" picks several at once, to delete them together. A card has three fields: plate, model, make.

const blank = (): Vehicle => ({ id: newId(), values: {} })

export function Vehicles() {
  const vehicles = useDriveList('vehicles')
  const lists = [vehicles]
  const loading = lists.some((l) => l.query.isPending)
  const failed = lists.find((l) => l.query.isError)
  const isOwner = useAuth().who?.isOwner === true || import.meta.env.DEV
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [query, setQuery] = useState('')

  const q = query.trim().toLocaleLowerCase()
  const shown = vehicles.items
    .filter((v) => !q || [plateOf(v), modelOf(v), makeOf(v)].some((x) => x.toLocaleLowerCase().includes(q)))
    .sort((a, b) => makeOf(a).localeCompare(makeOf(b), 'he') || modelOf(a).localeCompare(modelOf(b), 'he') || plateOf(a).localeCompare(plateOf(b), 'he'))
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

  // The owner adds the example vehicles once (the user's request, 2026-11-14).
  const [seedError, setSeedError] = useState<unknown>(null)
  const addSamples = async () => {
    setSeedError(null)
    try {
      await vehicles.save([...vehicles.items, ...sampleVehicles(vehicles.items)])
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
        {seedError != null && <DriveError error={seedError} action="save" />}
      </div>
    ) : null

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
                const line = [modelOf(v), makeOf(v)].filter(Boolean).join(' · ')
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
                        <span dir="ltr" className="block text-end font-mono text-lg font-semibold">{plateOf(v)}</span>
                        {line && <span className="block break-words text-sm text-slate-300">{line}</span>}
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

function VehicleForm({ vehicle, onDone }: { vehicle: Vehicle; onDone: () => void }) {
  const vehicles = useDriveList('vehicles')
  const [draft, setDraft] = useState(vehicle)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const exists = vehicles.items.some((v) => v.id === vehicle.id)
  // Models and makes already typed, offered while typing, so the same model is written the same way.
  const known = { [MODEL]: [...new Set(vehicles.items.map(modelOf).filter(Boolean))], [MAKE]: [...new Set(vehicles.items.map(makeOf).filter(Boolean))] }
  const setValue = (id: string, value: string) => setDraft((d) => ({ ...d, values: { ...d.values, [id]: value } }))

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
      {VEHICLE_FIELDS.map((f, i) => (
        <Field key={f.id} label={f.name}>
          <input
            autoFocus={i === 0 && !exists}
            type="text"
            dir={f.id === PLATE ? 'ltr' : 'auto'}
            list={f.id in known ? `vehicle-${f.id}s` : undefined}
            value={draft.values[f.id] ?? ''}
            onChange={(e) => setValue(f.id, e.target.value)}
            className={inputClass}
          />
        </Field>
      ))}
      {Object.entries(known).map(([id, values]) => (
        <datalist key={id} id={`vehicle-${id}s`}>
          {values.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      ))}
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
