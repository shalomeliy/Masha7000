import { tx } from '../i18n'
import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Chips, Field, inputClass } from '../components/Sheet'
import { DateField } from '../components/DateField'
import { isIsraeliId, isIsraeliMobile } from '../lib/catalog'
import { todayIso } from '../lib/dates'
import { markSent, readForm, submitForm, wasSent, type FormLists, type JoinDetails } from '../lib/join'

// The page a worker opens from the WhatsApp link. No sign-in: it only sends the answer to the
// manager, who reviews it before it reaches the workers list. Nothing else of the app is reachable here.

const blank = (): JoinDetails => ({ firstName: '', lastName: '', mobilePhone: '', certificationIds: [] })

type TextKey = 'firstName' | 'lastName' | 'mobilePhone' | 'idNumber' | 'personalNumber' | 'address' | 'homePhone' | 'emergencyPhone1' | 'emergencyPhone2' | 'notes'

const PHONES: [TextKey, string][] = [
  ['homePhone', tx('טלפון בבית')],
  ['emergencyPhone1', tx('טלפון חירום 1 (קרוב משפחה)')],
  ['emergencyPhone2', tx('טלפון חירום 2')],
]

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

export function JoinForm({ code }: { code: string }) {
  const [lists, setLists] = useState<FormLists | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<JoinDetails>(blank)
  const [birthValid, setBirthValid] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [sentBefore] = useState(() => wasSent(code))
  const [agreed, setAgreed] = useState(false)

  useEffect(() => {
    document.title = tx('טופס פרטי עובד')
    if (sentBefore) return
    readForm(code).then(
      (r) => setLists(r.lists),
      (e: Error) => setLoadError(e.message),
    )
  }, [code, sentBefore])

  const set = (k: TextKey) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }))

  const send = async () => {
    const err = !draft.firstName.trim()
      ? tx('צריך למלא שם פרטי')
      : !draft.lastName.trim()
        ? tx('צריך למלא שם משפחה')
        : !isIsraeliMobile(draft.mobilePhone)
          ? tx('הטלפון הנייד לא תקין. צריך 10 ספרות שמתחילות ב-05, למשל 050-1234567')
          : draft.idNumber?.trim() && !isIsraeliId(draft.idNumber)
            ? tx('תעודת הזהות לא תקינה. צריך 9 ספרות, למשל 012345678')
            : !birthValid
              ? tx('תאריך הלידה לא תקין')
              : !agreed
                ? tx('צריך לסמן שקראת את ההודעה על השימוש בפרטים')
                : null
    setError(err)
    if (err) return
    setBusy(true)
    try {
      await submitForm(code, { ...draft, idNumber: draft.idNumber?.replace(/[\s-]/g, '') || undefined })
      markSent(code)
      setSent(true)
      window.scrollTo(0, 0)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (sent)
    return (
      <main className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <CheckCircle2 size={48} className="text-emerald-400" aria-hidden />
        <h1 className="text-2xl font-bold">{tx('תודה, {trim}!', { trim: draft.firstName.trim() })}</h1>
        <p className="text-slate-300">{tx('הפרטים נשלחו למנהל. אפשר לסגור את הדף.')}</p>
      </main>
    )

  if (sentBefore)
    return (
      <main className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <CheckCircle2 size={48} className="text-emerald-400" aria-hidden />
        <h1 className="text-2xl font-bold">{tx('כבר שלחת את הפרטים')}</h1>
        <p className="text-slate-300">{tx('אי אפשר לשלוח שוב. אם צריך לתקן משהו, פנה למנהל.')}</p>
      </main>
    )

  if (loadError)
    return (
      <main className="mx-auto flex min-h-full max-w-md items-center justify-center px-6 text-center">
        <p role="alert" className="text-slate-300">{loadError}</p>
      </main>
    )

  if (!lists)
    return (
      <main className="flex min-h-full items-center justify-center gap-2 text-slate-400">
        <Loader2 className="animate-spin" size={20} aria-hidden />
        {tx('טוען את הטופס...')}
      </main>
    )

  return (
    <main className="mx-auto max-w-md space-y-5 px-4 pb-16 pt-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{tx('טופס פרטי עובד')}</h1>
        <p className="text-sm text-slate-400">{tx('ממלאים פעם אחת, והמנהל מוסיף אותך לרשימת העובדים. רק השם והנייד חובה.')}</p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Field label={tx('שם פרטי (חובה)')}>
          <input autoComplete="given-name" value={draft.firstName} onChange={set('firstName')} className={inputClass} />
        </Field>
        <Field label={tx('שם משפחה (חובה)')}>
          <input autoComplete="family-name" value={draft.lastName} onChange={set('lastName')} className={inputClass} />
        </Field>
      </div>
      <Field label={tx('טלפון נייד (חובה)')}>
        <input type="tel" dir="ltr" inputMode="tel" autoComplete="tel" value={draft.mobilePhone} onChange={set('mobilePhone')} className={`${inputClass} text-right`} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={tx('ת.ז')}>
          <input dir="ltr" inputMode="numeric" maxLength={11} value={draft.idNumber ?? ''} onChange={set('idNumber')} className={`${inputClass} text-right`} />
        </Field>
        <Field label={tx('מספר אישי')}>
          <input dir="ltr" inputMode="numeric" value={draft.personalNumber ?? ''} onChange={set('personalNumber')} className={`${inputClass} text-right`} />
        </Field>
      </div>
      <DateField
        label={tx('תאריך לידה')}
        value={draft.birthDate ?? ''}
        max={todayIso()}
        onChange={(value, valid) => {
          setDraft((d) => ({ ...d, birthDate: value || undefined }))
          setBirthValid(valid)
        }}
      />
      <Field label={tx('כתובת')}>
        <input autoComplete="street-address" value={draft.address ?? ''} onChange={set('address')} className={inputClass} />
      </Field>

      {lists.departments.length > 0 && (
        <div className="space-y-1">
          <span className="text-sm text-slate-300">{tx('מחלקה')}</span>
          <Chips
            options={lists.departments}
            selected={draft.departmentId ? [draft.departmentId] : []}
            onToggle={(id) => setDraft((d) => ({ ...d, departmentId: d.departmentId === id ? undefined : id }))}
          />
        </div>
      )}
      {lists.certifications.length > 0 && (
        <div className="space-y-1">
          <span className="text-sm text-slate-300">{tx('הסמכות שיש לך')}</span>
          <Chips
            options={lists.certifications}
            selected={draft.certificationIds}
            onToggle={(id) => setDraft((d) => ({ ...d, certificationIds: toggle(d.certificationIds, id) }))}
          />
        </div>
      )}

      {PHONES.map(([k, label]) => (
        <Field key={k} label={label}>
          <input type="tel" dir="ltr" inputMode="tel" value={draft[k] ?? ''} onChange={set(k)} className={`${inputClass} text-right`} />
        </Field>
      ))}
      <Field label={tx('הערות למנהל')}>
        <textarea rows={3} value={draft.notes ?? ''} onChange={set('notes')} className={inputClass} />
      </Field>

      {/* The notice the privacy law asks for when collecting personal details (purpose, who sees it, rights). */}
      <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm text-slate-300">
        <p>
          {tx('הפרטים נשלחים רק למנהל העבודה שלך, כדי לשבץ אותך במשמרות ולהתקשר אליך או לקרובים במקרה חירום. אין חובה חוקית למסור אותם, אבל בלי שם וטלפון המנהל לא יוכל לשבץ אותך. תוכל לבקש מהמנהל לראות, לתקן או למחוק את הפרטים.')}{' '}
          <a href="/privacy.html" target="_blank" rel="noopener" className="text-sky-300 underline">
            {tx('מדיניות הפרטיות')}
          </a>
        </p>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="size-5 shrink-0 accent-sky-500" />
          <span>{tx('קראתי ואני מסכים שהפרטים יישמרו לצורך הזה')}</span>
        </label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <button type="button" onClick={send} disabled={busy} className="min-h-12 w-full rounded-xl bg-sky-500 font-semibold text-slate-950 disabled:opacity-50">
        {busy ? tx('שולח...') : tx('שליחה למנהל')}
      </button>
    </main>
  )
}
