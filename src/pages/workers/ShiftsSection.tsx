import { tx } from '../../i18n'
import { useState } from 'react'
import { Chips, Field, inputClass, Sheet, SheetActions } from '../../components/Sheet'
import { countText, endsNextDay, newId, NIGHT_PLUS, SHIFT_END, SHIFT_START, shiftError, STANDBY_HEADCOUNT, STARTER_SHIFTS, tagNames, upsert } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import { useSaveSettings, useSettings } from '../../lib/data/useFeatures'
import { DEFAULT_REST_HOURS } from '../../lib/featureRules'
import { hoursRange } from '../../lib/hourlyShifts'
import type { ShiftDefinition } from '../../types/models'
import { AddButton, EditMark, EmptyState } from './common'

const blankShift = (): ShiftDefinition => ({
  id: newId(),
  name: '',
  startTime: SHIFT_START,
  endTime: SHIFT_END,
  requiredHeadcount: 1,
  requiredCertificationIds: [],
})

const hoursText = (s: ShiftDefinition, byHours: boolean) =>
  byHours
    ? `${hoursRange(s)}${endsNextDay(s) ? tx(' למחרת') : ''}`
    : tx('נגמרת ב-{endTime}{v}{v2}', { endTime: s.endTime, v: endsNextDay(s) ? tx(' למחרת') : '', v2: s.thenJob ? tx(', ואז עוד עבודה לפני החזרה לבסיס') : '' })

/** Is the team on shifts by hours (settings.shiftHours). */
export function useShiftHours() {
  const settings = useSettings()
  const h = settings.data?.shiftHours
  // The switch is offered to teams that went through the wizard (customers). A team from before it (the owner's,
  // Dolik's) sees no change, unless it already has the setting.
  const offered = !!settings.data?.onboarding || !!h
  return { on: !!h?.on, restHours: h?.restHours ?? DEFAULT_REST_HOURS, loaded: settings.isSuccess, offered }
}

// Settings > תבניות עבודה: "משמרות לפי שעות" on/off and the rest between shifts. Off only hides the hours:
// the types keep them, and turning it on again brings them back.
function HoursCard() {
  const hours = useShiftHours()
  const save = useSaveSettings()
  const [rest, setRest] = useState(String(hours.restHours))
  const [error, setError] = useState<string | null>(null)
  const write = async (on: boolean, restHours: number) => {
    setError(null)
    try {
      await save.mutateAsync({ shiftHours: { on, restHours } })
    } catch {
      setError(tx('השמירה לא הצליחה. בדוק את החיבור ונסה שוב.'))
    }
  }
  const saveRest = () => {
    const n = Number(rest)
    if (!Number.isFinite(n) || n < 0 || n > 24) {
      setError(tx('שעות מנוחה: מספר בין 0 ל-24'))
      return
    }
    if (n !== hours.restHours) void write(hours.on, Math.round(n))
  }
  if (!hours.loaded || !hours.offered) return null
  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{tx('משמרות לפי שעות')}</p>
          <p className="text-sm text-slate-400">{tx('לכל תבנית שעת התחלה וסיום. "שבץ" בודק שהשעות לא חופפות ושיש מנוחה בין משמרות.')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={hours.on}
          aria-label={tx('משמרות לפי שעות')}
          disabled={save.isPending}
          onClick={() => void write(!hours.on, hours.restHours)}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${hours.on ? 'bg-sky-500' : 'bg-slate-700'}`}
        >
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${hours.on ? 'start-7' : 'start-1'}`} aria-hidden />
        </button>
      </div>
      {hours.on && (
        <Field label={tx('שעות מנוחה לפחות בין שתי משמרות של אותו עובד')}>
          <input type="number" min={0} max={24} inputMode="numeric" value={rest} onChange={(e) => setRest(e.target.value)} onBlur={saveRest} className={inputClass} />
        </Field>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

export function ShiftsSection() {
  const shifts = useDriveList('shiftDefinitions')
  const certs = useDriveList('certifications')
  const [editing, setEditing] = useState<ShiftDefinition | null>(null)
  const [starterError, setStarterError] = useState<unknown>(null)
  const byHours = useShiftHours().on

  const addStarter = async () => {
    setStarterError(null)
    try {
      await shifts.save([...STARTER_SHIFTS.map((s) => ({ ...s, id: newId() })), NIGHT_PLUS])
    } catch (e) {
      setStarterError(e)
    }
  }

  return (
    <>
      <HoursCard />
      {shifts.items.length === 0 ? (
        <EmptyState
          text={tx('תבנית עבודה אומרת אם העבודה נגמרת באותו יום או למחרת, כמה אנשים צריך בה ואילו הסמכות חייבות להיות בה.')}
          addLabel={tx('הוספת תבנית עבודה')}
          onAdd={() => setEditing(blankShift())}
          starterLabel={tx('להתחיל עם: יום (עד 16:00), לילה (עד 16:00 למחרת), לינה (לילה ואז עוד עבודה)')}
          onStarter={addStarter}
          starterBusy={shifts.saving}
          starterError={starterError}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {shifts.items.map((s) => {
              const names = tagNames(s.requiredCertificationIds, certs.items)
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(s)}
                    className="relative w-full space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-4 pe-9 text-start"
                  >
                    <EditMark />
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-semibold">
                        {s.name}
                        {s.isStandby && <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-xs text-violet-200">{tx('כוננות')}</span>}
                      </span>
                      <span className="text-sm text-slate-400">{countText(s.requiredHeadcount ?? 1, tx('אדם אחד'), tx('אנשים'))}</span>
                    </span>
                    <span className="block text-sm text-slate-300">{hoursText(s, byHours)}</span>
                    <span className="block text-xs text-slate-400">
                      {names.length ? tx('נדרש: {v}', { v: names.join(', ') }) : tx('אין הסמכה נדרשת')}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <AddButton label={tx('הוספת תבנית עבודה')} onClick={() => setEditing(blankShift())} />
        </>
      )}

      <Sheet
        open={editing !== null}
        title={editing && shifts.items.some((s) => s.id === editing.id) ? tx('עריכת תבנית עבודה') : tx('תבנית עבודה חדשה')}
        onClose={() => setEditing(null)}
        locked={shifts.saving}
      >
        {editing && <ShiftForm shift={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </>
  )
}

function ShiftForm({ shift, onDone }: { shift: ShiftDefinition; onDone: () => void }) {
  const shifts = useDriveList('shiftDefinitions')
  const certs = useDriveList('certifications')
  const records = useDriveList('shifts')
  const [draft, setDraft] = useState(shift)
  const [headcount, setHeadcount] = useState(String(shift.requiredHeadcount ?? 1))
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const exists = shifts.items.some((s) => s.id === shift.id)
  const inUse = records.items.filter((r) => r.shiftDefinitionId === shift.id).length
  const byHours = useShiftHours().on

  const write = async (next: ShiftDefinition[]) => {
    setBusy(true)
    setSaveError(null)
    try {
      await shifts.save(next)
      onDone()
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    // Without hours (the owner's choice): every saved shift gets the standard start and end.
    // By hours: the type's own hours; it ends the next day when its end is not after its start, or when marked
    // "נגמרת למחרת" (a night until 16:00 tomorrow, which keeps the day-job-the-next-morning rule).
    const { endsNextDay: mark, ...rest } = draft
    const clean: ShiftDefinition = byHours
      ? { ...rest, name: draft.name.trim(), requiredHeadcount: Number(headcount), ...(mark === true ? { endsNextDay: true } : {}) }
      : { ...draft, name: draft.name.trim(), startTime: SHIFT_START, endTime: SHIFT_END, endsNextDay: endsNextDay(draft), requiredHeadcount: Number(headcount) }
    if (byHours && clean.startTime === clean.endTime && !clean.endsNextDay) {
      setError(tx('שעת הסיום צריכה להיות שונה משעת ההתחלה'))
      return
    }
    const err = shiftError(clean, shifts.items, shift.id)
    setError(err)
    if (!err) write(upsert(shifts.items, clean))
  }

  const toggleStandby = (on: boolean) => {
    setDraft({ ...draft, isStandby: on || undefined })
    if (on) setHeadcount(String(STANDBY_HEADCOUNT))
    if (!on && headcount === String(STANDBY_HEADCOUNT)) setHeadcount('1')
  }

  const toggleCert = (id: string) =>
    setDraft((d) => ({ ...d, requiredCertificationIds: d.requiredCertificationIds.includes(id) ? d.requiredCertificationIds.filter((r) => r !== id) : [...d.requiredCertificationIds, id] }))

  return (
    <>
      <Field label={tx('שם התבנית')}>
        <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} />
      </Field>
      {byHours && !draft.thenJob && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={tx('מתחילה ב')}>
            <input type="time" dir="ltr" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} className={inputClass} />
          </Field>
          <Field label={tx('נגמרת ב')}>
            <input type="time" dir="ltr" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} className={inputClass} />
          </Field>
        </div>
      )}
      {byHours && !draft.thenJob ? (
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={draft.endsNextDay === true}
            onChange={(e) => setDraft((d) => ({ ...d, endsNextDay: e.target.checked || undefined }))}
            className="size-5 accent-sky-500"
          />
          <span>
            {tx('נגמרת למחרת')}
            <span className="block text-xs text-slate-400">
              {draft.endTime <= draft.startTime ? tx('השעות כבר עוברות את חצות, אז היא נגמרת למחרת בכל מקרה') : tx('גם כשהסיום אחרי ההתחלה: לילה עד מחר ב-{endTime}', { endTime: draft.endTime })}
            </span>
          </span>
        </label>
      ) : draft.thenJob ? (
        <p className="text-sm text-slate-300">
          {tx('לילה, ואחריו הצוות עושה עוד עבודה לפני החזרה לבסיס. נספרת כעבודת לילה.')}
        </p>
      ) : (
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={endsNextDay(draft)}
            onChange={(e) => setDraft((d) => ({ ...d, endsNextDay: e.target.checked }))}
            className="size-5 accent-sky-500"
          />
          <span>
            {tx('נגמרת למחרת')}
            <span className="block text-xs text-slate-400">{tx('עבודת לילה: נגמרת ב-16:00 ביום שאחרי')}</span>
          </span>
        </label>
      )}
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" checked={!!draft.isStandby} onChange={(e) => toggleStandby(e.target.checked)} className="size-5 accent-sky-500" />
        <span>
          {tx('עבודת כוננות')}
          <span className="block text-xs text-slate-400">{tx('אנשי הצוות ממתינים בבית לקריאה')}</span>
        </span>
      </label>
      <Field label={tx('כמה אנשים צריך')}>
        <input type="number" min={1} inputMode="numeric" value={headcount} onChange={(e) => setHeadcount(e.target.value)} className={inputClass} />
      </Field>
      <div className="space-y-1">
        <span className="text-sm text-slate-300">{tx('הסמכות שחייבות להיות בעבודה')}</span>
        {certs.items.length ? (
          <Chips options={certs.items} selected={draft.requiredCertificationIds} onToggle={toggleCert} />
        ) : (
          <p className="text-sm text-amber-300">{tx('עוד אין הסמכות. אפשר להוסיף אותן בלשונית "הסמכות".')}</p>
        )}
      </div>
      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={exists && !shift.thenJob ? () => write(shifts.items.filter((s) => s.id !== shift.id)) : undefined}
        deleteWarning={tx('למחוק את תבנית העבודה "{name}"? אי אפשר לבטל את זה.{v}', { name: shift.name, v: inUse ? tx(' {v} מהתבנית הזו: הן יישארו ביומן בלי תבנית, כעבודת יום רגילה.', { v: countText(inUse, tx('עבודה אחת ביומן היא'), tx('עבודות ביומן הן')) }) : '' })}
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}
