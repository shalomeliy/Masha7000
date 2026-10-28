import { useState } from 'react'
import { ClipboardPaste, Plus, X } from 'lucide-react'
import { DateField } from '../../components/DateField'
import { DictationField } from '../../components/DictationField'
import { blankConstraint, constraintError, constraintText, isOver, parseReply } from '../../lib/constraints'
import { todayIso } from '../../lib/dates'
import { addDays, HEBREW_DAYS, showDate, weekOf } from '../../lib/shifts'
import type { Constraint } from '../../types/models'

// The worker's constraints inside the worker editor. Saved with the worker.

const pill = (on: boolean) =>
  `min-h-11 rounded-full border px-4 text-sm ${on ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300'}`

const WHEN: { id: Constraint['when']; label: string }[] = [
  { id: 'dates', label: 'בתאריכים' },
  { id: 'weekdays', label: 'כל שבוע בימים' },
  { id: 'always', label: 'תמיד' },
]

export function ConstraintsField({
  value,
  onChange,
  onNotes,
}: {
  value: Constraint[]
  onChange: (v: Constraint[]) => void
  onNotes: (text: string) => void // the notes line of a pasted WhatsApp reply
}) {
  const today = todayIso()
  const [editing, setEditing] = useState<Constraint | null>(null)
  const [pasting, setPasting] = useState(false)
  const shown = [...value].sort((a, b) => Number(isOver(a, today)) - Number(isOver(b, today)) || (a.from ?? '').localeCompare(b.from ?? ''))

  const save = (c: Constraint) => {
    onChange(value.some((x) => x.id === c.id) ? value.map((x) => (x.id === c.id ? c : x)) : [...value, c])
    setEditing(null)
  }

  return (
    <div className="space-y-2">
      <span className="text-sm text-slate-300">אילוצים</span>
      <p className="text-xs text-slate-400">מתי העובד לא יכול לעבוד. "שבץ" לא יבחר אותו בזמנים האלה.</p>
      {shown.map((c) =>
        editing?.id === c.id ? (
          <ConstraintEditor key={c.id} initial={editing} onSave={save} onCancel={() => setEditing(null)} />
        ) : (
          <div key={c.id} className={`flex items-center gap-1 rounded-xl border border-amber-500/30 bg-amber-500/5 ${isOver(c, today) ? 'opacity-50' : ''}`}>
            <button type="button" onClick={() => setEditing(c)} className="min-h-11 min-w-0 flex-1 px-3 py-2 text-start text-sm">
              <span className="block text-amber-200">
                {constraintText(c)}
                {isOver(c, today) && ' (עבר)'}
              </span>
              {c.note && <span className="block truncate text-xs text-slate-400">{c.note}</span>}
            </button>
            <button
              type="button"
              aria-label={`מחיקת האילוץ: ${constraintText(c)}`}
              onClick={() => onChange(value.filter((x) => x.id !== c.id))}
              className="flex size-11 shrink-0 items-center justify-center text-slate-400"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
        ),
      )}
      {editing && !value.some((x) => x.id === editing.id) && <ConstraintEditor initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
      {pasting && (
        <PasteReply
          onDone={(added, notes) => {
            onChange([...value, ...added])
            if (notes) onNotes(notes)
            setPasting(false)
          }}
          onCancel={() => setPasting(false)}
        />
      )}
      {!editing && !pasting && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditing(blankConstraint(today))}
            className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-slate-700 text-sm text-slate-200"
          >
            <Plus size={16} aria-hidden />
            הוספת אילוץ
          </button>
          <button
            type="button"
            onClick={() => setPasting(true)}
            className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-slate-700 text-sm text-slate-200"
          >
            <ClipboardPaste size={16} aria-hidden />
            הדבקת תשובה מוואטסאפ
          </button>
        </div>
      )}
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
      to: when === 'dates' ? (c.to ?? c.from ?? todayIso()) : undefined,
      weekdays: when === 'weekdays' ? (c.weekdays ?? []) : undefined,
      nightsOnly: when === 'always' ? true : c.nightsOnly,
    })

  const save = () => {
    const clean: Constraint = { ...c, note: c.note?.trim() || undefined, nightsOnly: c.nightsOnly || undefined }
    const err = !datesValid.from || !datesValid.to ? 'יש תאריך לא תקין' : constraintError(clean)
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
            label="מתאריך"
            value={c.from ?? ''}
            required
            onChange={(from, ok) => {
              // Moving the start past the end moves the end with it: one day off is the usual case.
              set({ from, to: !c.to || c.to < from ? from : c.to })
              setDatesValid((v) => ({ ...v, from: ok }))
            }}
          />
          <DateField label="עד תאריך" value={c.to ?? ''} min={c.from} required onChange={(to, ok) => (set({ to }), setDatesValid((v) => ({ ...v, to: ok })))} />
        </div>
      )}
      {c.when === 'weekdays' && (
        <div className="flex flex-wrap gap-2">
          {HEBREW_DAYS.map((name, d) => {
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
      {c.when === 'always' ? (
        <p className="text-sm text-slate-300">העובד לא ישובץ אף פעם למשמרת לילה.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={!c.nightsOnly} onClick={() => set({ nightsOnly: undefined })} className={pill(!c.nightsOnly)}>
            לא יכול בכלל
          </button>
          <button type="button" aria-pressed={!!c.nightsOnly} onClick={() => set({ nightsOnly: true })} className={pill(!!c.nightsOnly)}>
            רק בלי לילה
          </button>
        </div>
      )}
      <DictationField label="פירוט (לא חובה)" value={c.note ?? ''} onChange={(note) => set({ note })} placeholder="למשל: חתונה של אח, תור לרופא" />
      <p className="text-sm text-amber-200">{constraintText(c)}</p>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={save} className="min-h-11 flex-[2] rounded-xl bg-sky-500 text-sm font-semibold text-slate-950">
          אישור
        </button>
        <button type="button" onClick={onCancel} className="min-h-11 flex-1 rounded-xl border border-slate-700 text-sm text-slate-300">
          ביטול
        </button>
      </div>
    </div>
  )
}

function PasteReply({ onDone, onCancel }: { onDone: (added: Constraint[], notes: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('')
  // Used only when the reply lost its header line with the dates; the request is usually for next week.
  const [weekStart, setWeekStart] = useState(() => addDays(weekOf(todayIso()).start, 7))
  const parsed = text.trim() ? parseReply(text, weekStart) : null

  return (
    <div className="space-y-3 rounded-2xl border border-sky-500/40 bg-slate-950 p-3">
      <DictationField label="הדבק כאן את התשובה של העובד" value={text} onChange={setText} />
      {parsed && !parsed.weekStart && (
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <span>לא מצאתי תאריכים בהודעה. השבוע:</span>
          <button type="button" aria-label="שבוע קודם" onClick={() => setWeekStart(addDays(weekStart, -7))} className="min-h-11 px-2 text-sky-300">
            ›
          </button>
          <span>
            {showDate(weekStart)} עד {showDate(addDays(weekStart, 6))}
          </span>
          <button type="button" aria-label="שבוע הבא" onClick={() => setWeekStart(addDays(weekStart, 7))} className="min-h-11 px-2 text-sky-300">
            ‹
          </button>
        </div>
      )}
      {parsed && (
        <div className="space-y-1 text-sm" aria-live="polite">
          {parsed.constraints.length ? (
            parsed.constraints.map((c) => (
              <p key={c.id} className="text-amber-200">
                {constraintText(c)}
                {c.note && <span className="text-slate-400"> · {c.note}</span>}
              </p>
            ))
          ) : (
            <p className="text-emerald-300">אין אילוצים בתשובה הזו.</p>
          )}
          {parsed.notes && <p className="text-slate-300">הערות: {parsed.notes} (יתווספו להערות של העובד)</p>}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!parsed}
          onClick={() => parsed && onDone(parsed.constraints, parsed.notes)}
          className="min-h-11 flex-[2] rounded-xl bg-sky-500 text-sm font-semibold text-slate-950 disabled:opacity-50"
        >
          הוספה לאילוצים
        </button>
        <button type="button" onClick={onCancel} className="min-h-11 flex-1 rounded-xl border border-slate-700 text-sm text-slate-300">
          ביטול
        </button>
      </div>
    </div>
  )
}
