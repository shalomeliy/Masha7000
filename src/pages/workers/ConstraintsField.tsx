import { useState } from 'react'
import { ClipboardPaste, Plus, X } from 'lucide-react'
import { DateField } from '../../components/DateField'
import { DictationField } from '../../components/DictationField'
import { blankConstraint, constraintError, constraintText, isOver, parseReply, readAnswer, readingText } from '../../lib/constraints'
import { todayIso } from '../../lib/dates'
import { addDays, HEBREW_DAYS, showDate, weekday, weekOf } from '../../lib/shifts'
import type { Constraint, DayPart } from '../../types/models'

// The worker's constraints inside the worker editor. Saved with the worker.

const pill = (on: boolean) =>
  `min-h-11 rounded-full border px-4 text-sm ${on ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300'}`

const WHEN: { id: Constraint['when']; label: string }[] = [
  { id: 'dates', label: 'בתאריכים' },
  { id: 'weekdays', label: 'כל שבוע בימים' },
  { id: 'always', label: 'תמיד' },
]

// Which part of the day. An evening keeps the day shift (until 16:00) open; nights only blocks night jobs.
const PARTS: { id: DayPart | undefined | 'nights'; label: string }[] = [
  { id: undefined, label: 'כל היום' },
  { id: 'morning', label: 'בוקר' },
  { id: 'noon', label: 'צהריים' },
  { id: 'evening', label: 'ערב' },
  { id: 'nights', label: 'רק בלי לילה' },
]
// The same choices in the paste preview's list, where a value has to be a string.
const partKey = (c: Constraint) => (c.nightsOnly ? 'nights' : (c.part ?? 'all'))
const fromKey = (key: string): Pick<Constraint, 'part' | 'nightsOnly' | 'guess'> =>
  key === 'nights' ? { nightsOnly: true } : { part: key === 'all' ? undefined : (key as DayPart) }

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
              {c.guess && <span className="block text-xs text-red-300">ניחוש: לא הבנתי את המילים. לחץ כדי לבדוק.</span>}
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
    // Checked by the manager: no longer a guess.
    const clean: Constraint = { ...c, note: c.note?.trim() || undefined, nightsOnly: c.nightsOnly || undefined, guess: undefined }
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
  // The manager's fixes to what was understood, by row; the reply is read again on every keystroke.
  const [fixes, setFixes] = useState<Record<number, string>>({})
  const read = text.trim() ? parseReply(text, weekStart) : null
  const parsed = read && { ...read, constraints: read.constraints.map((c, i) => (fixes[i] ? { ...c, part: undefined, nightsOnly: undefined, guess: undefined, ...fromKey(fixes[i]) } : c)) }

  return (
    <div className="space-y-3 rounded-2xl border border-sky-500/40 bg-slate-950 p-3">
      <DictationField label="הדבק כאן את התשובה של העובד" value={text} onChange={(t) => (setText(t), setFixes({}))} />
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
            parsed.constraints.map((c, i) => {
              const day = `${HEBREW_DAYS[weekday(c.from!)]} ${showDate(c.from!)}`
              return (
                <div key={i} className={`flex items-center gap-2 rounded-xl border px-2 py-1 ${c.guess ? 'border-red-500/50' : 'border-amber-500/30'}`}>
                  <div className="min-w-0 flex-1">
                    <span className={`block ${c.guess ? 'text-red-300' : 'text-amber-200'}`}>
                      {day}: {readingText({ ...c, cause: fixes[i] ? undefined : readAnswer(c.note ?? '').cause })}
                    </span>
                    <span className="block truncate text-xs text-slate-400">"{c.note}"</span>
                  </div>
                  <select
                    aria-label={`תיקון ${day}`}
                    value={partKey(c)}
                    onChange={(e) => setFixes({ ...fixes, [i]: e.target.value })}
                    className="min-h-11 shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2 text-sm text-slate-200"
                  >
                    {PARTS.map((p) => (
                      <option key={p.label} value={p.id ?? 'all'}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })
          ) : (
            <p className="text-emerald-300">אין אילוצים בתשובה הזו.</p>
          )}
          {parsed.constraints.length > 0 && <p className="text-xs text-slate-400">בדוק מה הבנתי בכל יום. אם טעיתי, בחר נכון ברשימה שליד היום.</p>}
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
