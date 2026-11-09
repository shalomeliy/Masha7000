import { tx } from '../../i18n'
import { useEffect, useRef, useState } from 'react'
import { DateField } from '../../components/DateField'
import { DictationField } from '../../components/DictationField'
import { blankConstraint, constraintError, constraintText } from '../../lib/constraints'
import { todayIso } from '../../lib/dates'
import { DAY_NAMES } from '../../lib/shifts'
import type { Constraint, DayPart } from '../../types/models'

// A worker's constraint, added or changed in the worker's card. Saved with the worker.

const pill = (on: boolean) =>
  `min-h-11 rounded-full border px-4 text-sm ${on ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300'}`

const WHEN: { id: Constraint['when']; label: string }[] = [
  { id: 'dates', label: tx('בתאריכים') },
  { id: 'weekdays', label: tx('כל שבוע בימים') },
  { id: 'always', label: tx('תמיד') },
]

// Which part of the day. An evening keeps the day shift (until 16:00) open; nights only blocks night jobs.
const PARTS: { id: DayPart | undefined | 'nights'; label: string }[] = [
  { id: undefined, label: tx('כל היום') },
  { id: 'morning', label: tx('בוקר') },
  { id: 'noon', label: tx('צהריים') },
  { id: 'evening', label: tx('ערב') },
  { id: 'nights', label: tx('רק בלי לילה') },
]

/**
 * Where a constraint is added or changed in the worker's card: the editor opens here, next to the
 * personal calendar, from its "add" button or a pencil. The list of constraints is the calendar itself
 * (the user's request, 2026-11-09: no separate list or buttons at the top of the card).
 */
export function ConstraintsField({
  value,
  onChange,
  open,
  add,
}: {
  value: Constraint[]
  open?: { id: string; n: number } // a pencil in a calendar: open this constraint's editor (n: each tap)
  add?: number // grows by one on each tap of "הוספת אילוץ": a new constraint's editor
  onChange: (v: Constraint[]) => void
}) {
  const [editing, setEditing] = useState<Constraint | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const show = (c: Constraint) => {
    setEditing(c)
    // After it renders: bring the editor into view.
    setTimeout(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }
  useEffect(() => {
    const c = open && value.find((x) => x.id === open.id)
    if (c) show(c)
    // Only a new tap opens it, not every change of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.n])
  useEffect(() => {
    if (add) show(blankConstraint(todayIso()))
  }, [add])

  const save = (c: Constraint) => {
    onChange(value.some((x) => x.id === c.id) ? value.map((x) => (x.id === c.id ? c : x)) : [...value, c])
    setEditing(null)
  }

  return (
    <div ref={box} className="scroll-mt-4">
      {editing && <ConstraintEditor key={editing.id} initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
    </div>
  )
}

function ConstraintEditor({ initial, onSave, onCancel }: { initial: Constraint; onSave: (c: Constraint) => void; onCancel: () => void }) {
  const [c, setC] = useState(initial)
  const [datesValid, setDatesValid] = useState({ from: true, to: true })
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Constraint>) => setC((x) => ({ ...x, ...patch }))

  const pickWhen = (when: Constraint['when']) =>
    set({
      when,
      from: when === 'dates' ? (c.from ?? todayIso()) : undefined,
      to: when === 'dates' ? (c.to ?? c.from ?? todayIso()) : undefined, // weekly: no last date until one is picked
      weekdays: when === 'weekdays' ? (c.weekdays ?? []) : undefined,
      nightsOnly: when === 'always' ? true : c.nightsOnly,
    })

  const save = () => {
    // Checked by the manager: no longer a guess.
    const clean: Constraint = { ...c, note: c.note?.trim() || undefined, nightsOnly: c.nightsOnly || undefined, guess: undefined }
    const err = !datesValid.from || !datesValid.to ? tx('יש תאריך לא תקין') : constraintError(clean)
    setError(err)
    if (!err) onSave(clean)
  }

  return (
    <div className="space-y-3 rounded-2xl border border-sky-500/40 bg-slate-950 p-3">
      <div className="flex flex-wrap gap-2">
        {WHEN.map((w) => (
          <button key={w.id} type="button" aria-pressed={c.when === w.id} onClick={() => pickWhen(w.id)} className={pill(c.when === w.id)}>
            {w.label}
          </button>
        ))}
      </div>
      {c.when === 'dates' && (
        <div className="grid grid-cols-2 gap-3">
          <DateField
            label={tx('מתאריך')}
            value={c.from ?? ''}
            required
            onChange={(from, ok) => {
              // Moving the start past the end moves the end with it: one day off is the usual case.
              set({ from, to: !c.to || c.to < from ? from : c.to })
              setDatesValid((v) => ({ ...v, from: ok }))
            }}
          />
          <DateField label={tx('עד תאריך')} value={c.to ?? ''} min={c.from} required onChange={(to, ok) => (set({ to }), setDatesValid((v) => ({ ...v, to: ok })))} />
        </div>
      )}
      {c.when === 'weekdays' && (
        <div className="flex flex-wrap gap-2">
          {DAY_NAMES.map((name, d) => {
            const on = !!c.weekdays?.includes(d)
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                onClick={() => set({ weekdays: on ? c.weekdays!.filter((x) => x !== d) : [...(c.weekdays ?? []), d] })}
                className={pill(on)}
              >
                {name}
              </button>
            )
          })}
        </div>
      )}
      {c.when === 'weekdays' && (
        <DateField
          label={tx('עד תאריך (לא חובה, ריק = כל שבוע בלי סוף)')}
          value={c.to ?? ''}
          min={todayIso()}
          onChange={(to, ok) => (set({ to: to || undefined }), setDatesValid((v) => ({ ...v, to: ok })))}
        />
      )}
      {c.when === 'always' ? (
        <p className="text-sm text-slate-300">{tx('העובד לא ישובץ אף פעם לעבודת לילה.')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {PARTS.map((p) => {
            const on = p.id === 'nights' ? !!c.nightsOnly : !c.nightsOnly && c.part === p.id
            return (
              <button
                key={p.label}
                type="button"
                aria-pressed={on}
                onClick={() => set(p.id === 'nights' ? { nightsOnly: true, part: undefined } : { nightsOnly: undefined, part: p.id })}
                className={pill(on)}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      )}
      <DictationField label={tx('פירוט (לא חובה)')} value={c.note ?? ''} onChange={(note) => set({ note })} placeholder={tx('למשל: חתונה של אח, תור לרופא')} />
      <p className="text-sm text-amber-200">{constraintText(c)}</p>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={save} className="min-h-11 flex-[2] rounded-xl bg-sky-500 text-sm font-semibold text-slate-950">
          {tx('אישור')}
        </button>
        <button type="button" onClick={onCancel} className="min-h-11 flex-1 rounded-xl border border-slate-700 text-sm text-slate-300">
          {tx('ביטול')}
        </button>
      </div>
    </div>
  )
}
