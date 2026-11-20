import { dayNames, tx } from '../i18n'
import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { DateField } from '../components/DateField'
import { DictationField } from '../components/DictationField'
import { DriveError } from '../components/DriveError'
import { Field, inputClass, Sheet, SheetActions } from '../components/Sheet'
import { newId, upsert } from '../lib/catalog'
import { useDriveList } from '../lib/data/useDriveList'
import { todayIso } from '../lib/dates'
import { byDay, cleanEntry, durationOf, endsNextDay, hoursText, journalError, spokenTimes } from '../lib/journal'
import type { JournalEntry } from '../types/models'
import { EditMark, EmptyState } from './workers/common'

// "יומן אישי" (the user's request, 2026-11-20, in place of the "רכבים" button): the manager writes down
// what he did, from when to when. Start and end are required, the text is free, typed or dictated
// ("הקראה"). "שעת התחלה 8:30 ... שעת סיום 12:00" said while dictating fills the time fields; nothing is
// saved until the manager presses Save.

const blank = (): JournalEntry => ({ id: newId(), date: todayIso(), start: '', end: '', text: '' })

const dayTitle = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${dayNames()[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}.${m}.${y}`
}

export function Journal() {
  const journal = useDriveList('journal')
  const [editing, setEditing] = useState<JournalEntry | null>(null)

  const days = byDay(journal.items)
  return (
    <section className="space-y-4 px-4 pt-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{tx('יומן אישי')}</h1>
        {journal.query.isSuccess && (
          <button
            type="button"
            onClick={() => setEditing(blank())}
            aria-label={tx('הוספת רישום')}
            className="flex min-h-9 shrink-0 items-center gap-1 rounded-lg bg-sky-600 px-2.5 text-sm font-semibold text-white active:bg-sky-700"
          >
            {tx('הוסף')}
            <Plus size={16} aria-hidden />
          </button>
        )}
      </div>

      {journal.query.isError ? (
        <DriveError error={journal.query.error} action="load" onRetry={() => journal.query.refetch()} />
      ) : journal.query.isPending ? (
        <p className="flex items-center gap-2 text-slate-400">
          <Loader2 className="animate-spin" size={18} aria-hidden />
          {tx('טוען מגוגל דרייב...')}
        </p>
      ) : days.length === 0 ? (
        <EmptyState text={tx('עוד אין רישומים. כותבים מה עשית, משעה עד שעה, ושומרים.')} addLabel={tx('הוספת רישום')} onAdd={() => setEditing(blank())} />
      ) : (
        <div className="space-y-5">
          {days.map((day) => (
            <div key={day.date} className="space-y-2">
              <h2 className="flex items-baseline justify-between gap-2 text-sm font-semibold text-slate-300">
                <span>{dayTitle(day.date)}</span>
                <span className="text-xs font-normal text-slate-400">{tx('סה"כ {h} שעות', { h: hoursText(day.total) })}</span>
              </h2>
              <ul className="space-y-2">
                {day.entries.map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => setEditing(e)} className="relative flex w-full flex-col gap-1 rounded-2xl border border-slate-800 bg-slate-900 p-4 pe-9 text-start">
                      <EditMark />
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span dir="ltr" className="font-mono text-lg font-semibold">
                          {e.start}–{e.end}
                        </span>
                        <span className="text-xs text-slate-400">
                          {endsNextDay(e) ? tx('{h} שעות, עד למחרת', { h: hoursText(durationOf(e)) }) : tx('{h} שעות', { h: hoursText(durationOf(e)) })}
                        </span>
                      </span>
                      {e.text && <span className="block whitespace-pre-wrap break-words text-sm text-slate-200">{e.text}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Sheet open={editing !== null} title={editing && journal.items.some((x) => x.id === editing.id) ? tx('עריכת רישום') : tx('רישום חדש')} onClose={() => setEditing(null)} locked={journal.saving}>
        {editing && <EntryForm entry={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </section>
  )
}

function EntryForm({ entry, onDone }: { entry: JournalEntry; onDone: () => void }) {
  const journal = useDriveList('journal')
  const [draft, setDraft] = useState(entry)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const exists = journal.items.some((x) => x.id === entry.id)
  const set = (patch: Partial<JournalEntry>) => setDraft((d) => ({ ...d, ...patch }))
  const [heardTimes, setHeardTimes] = useState(false)
  // Times said while dictating go into their fields, out of the text; the manager checks and saves.
  const dictated = (said: string) => {
    const t = spokenTimes(said)
    if (!t.start && !t.end) return
    set({ text: t.text, ...(t.start ? { start: t.start } : {}), ...(t.end ? { end: t.end } : {}) })
    setHeardTimes(true)
  }

  const write = async (next: JournalEntry[]) => {
    setBusy(true)
    setSaveError(null)
    try {
      await journal.save(next)
      onDone()
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }
  const save = () => {
    const clean = cleanEntry(draft)
    const err = journalError(clean)
    setError(err)
    if (!err) void write(upsert(journal.items, clean))
  }

  return (
    <>
      <DateField label={tx('תאריך')} value={draft.date} required onChange={(date) => set({ date })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={tx('שעת התחלה')}>
          <input type="time" dir="ltr" value={draft.start} onChange={(e) => set({ start: e.target.value })} aria-invalid={error !== null && !draft.start} className={inputClass} />
        </Field>
        <Field label={tx('שעת סיום')}>
          <input type="time" dir="ltr" value={draft.end} onChange={(e) => set({ end: e.target.value })} aria-invalid={error !== null && draft.start !== '' && !draft.end} className={inputClass} />
        </Field>
      </div>
      {endsNextDay(draft) && <p className="text-sm text-amber-300">{tx('מסתיים למחרת: {h} שעות', { h: hoursText(durationOf(draft)) })}</p>}
      <DictationField label={tx('מה עשיתי')} value={draft.text} onChange={(text) => set({ text })} placeholder={tx('מלל חופשי. בהקראה אפשר לומר "שעת התחלה 8:30" ו"שעת סיום 12:00"')} onDone={dictated} micLabel={tx('הקראה')} />
      {heardTimes && <p className="text-sm text-sky-300">{tx('השעות מההקראה נכנסו לשדות. בדוק ולחץ שמירה.')}</p>}
      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={exists ? () => void write(journal.items.filter((x) => x.id !== entry.id)) : undefined}
        deleteWarning={tx('למחוק את הרישום? אי אפשר לבטל את זה.')}
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}
