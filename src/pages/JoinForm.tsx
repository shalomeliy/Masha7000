import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Chips, Field, inputClass } from '../components/Sheet'
import { DateField } from '../components/DateField'
import { isIsraeliId, isIsraeliMobile } from '../lib/catalog'
import { todayIso } from '../lib/dates'
import { markSent, readForm, submitForm, wasSent, type FormLists, type JoinDetails } from '../lib/join'

// The page a worker opens from the WhatsApp link. No sign-in: it only sends the answer to the
// manager, who reviews it before it reaches the workers list. Nothing else of the app is reachable here.

const blank = (): JoinDetails => ({ firstName: '', lastName: '', mobilePhone: '', roleIds: [], certificationIds: [] })

type TextKey = 'firstName' | 'lastName' | 'mobilePhone' | 'idNumber' | 'personalNumber' | 'address' | 'homePhone' | 'emergencyPhone1' | 'emergencyPhone2' | 'notes'

const PHONES: [TextKey, string][] = [
  ['homePhone', 'טלפון בבית'],
  ['emergencyPhone1', 'טלפון חירום 1 (קרוב משפחה)'],
  ['emergencyPhone2', 'טלפון חירום 2'],
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

  useEffect(() => {
    document.title = 'טופס פרטי עובד'
    if (sentBefore) return
    readForm(code).then(
      (r) => setLists(r.lists),
      (e: Error) => setLoadError(e.message),
    )
  }, [code, sentBefore])

  const set = (k: TextKey) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }))

  const send = async () => {
    const err = !draft.firstName.trim()
      ? 'צריך למלא שם פרטי'
      : !draft.lastName.trim()
        ? 'צריך למלא שם משפחה'
        : !isIsraeliMobile(draft.mobilePhone)
          ? 'הטלפון הנייד לא תקין. צריך 10 ספרות שמתחילות ב-05, למשל 050-1234567'
          : draft.idNumber?.trim() && !isIsraeliId(draft.idNumber)
            ? 'תעודת הזהות לא תקינה. צריך 9 ספרות, למשל 012345678'
            : !birthValid
              ? 'תאריך הלידה לא תקין'
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
        <h1 className="text-2xl font-bold">תודה, {draft.firstName.trim()}!</h1>
        <p className="text-slate-300">הפרטים נשלחו למנהל. אפשר לסגור את הדף.</p>
      </main>
    )

  if (sentBefore)
    return (
      <main className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <CheckCircle2 size={48} className="text-emerald-400" aria-hidden />
        <h1 className="text-2xl font-bold">כבר שלחת את הפרטים</h1>
        <p className="text-slate-300">אי אפשר לשלוח שוב. אם צריך לתקן משהו, פנה למנהל.</p>
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
        טוען את הטופס...
      </main>
    )

  return (
    <main className="mx-auto max-w-md space-y-5 px-4 pb-16 pt-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">טופס פרטי עובד</h1>
        <p className="text-sm text-slate-400">ממלאים פעם אחת, והמנהל מוסיף אותך לרשימת העובדים. רק השם והנייד חובה.</p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Field label="שם פרטי (חובה)">
          <input autoComplete="given-name" value={draft.firstName} onChange={set('firstName')} className={inputClass} />
        </Field>
        <Field label="שם משפחה (חובה)">
          <input autoComplete="family-name" value={draft.lastName} onChange={set('lastName')} className={inputClass} />
        </Field>
      </div>
      <Field label="טלפון נייד (חובה)">
        <input type="tel" dir="ltr" inputMode="tel" autoComplete="tel" value={draft.mobilePhone} onChange={set('mobilePhone')} className={`${inputClass} text-right`} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ת.ז">
          <input dir="ltr" inputMode="numeric" maxLength={11} value={draft.idNumber ?? ''} onChange={set('idNumber')} className={`${inputClass} text-right`} />
        </Field>
        <Field label="מספר אישי">
          <input dir="ltr" inputMode="numeric" value={draft.personalNumber ?? ''} onChange={set('personalNumber')} className={`${inputClass} text-right`} />
        </Field>
      </div>
      <DateField
        label="תאריך לידה"
        value={draft.birthDate ?? ''}
        max={todayIso()}
        onChange={(value, valid) => {
          setDraft((d) => ({ ...d, birthDate: value || undefined }))
          setBirthValid(valid)
        }}
      />
      <Field label="כתובת">
        <input autoComplete="street-address" value={draft.address ?? ''} onChange={set('address')} className={inputClass} />
      </Field>

      {lists.departments.length > 0 && (
        <div className="space-y-1">
          <span className="text-sm text-slate-300">מחלקה</span>
          <Chips
            options={lists.departments}
            selected={draft.departmentId ? [draft.departmentId] : []}
            onToggle={(id) => setDraft((d) => ({ ...d, departmentId: d.departmentId === id ? undefined : id }))}
          />
        </div>
      )}
      {lists.roles.length > 0 && (
        <div className="space-y-1">
          <span className="text-sm text-slate-300">תפקידים שלך (אפשר כמה)</span>
          <Chips options={lists.roles} selected={draft.roleIds} onToggle={(id) => setDraft((d) => ({ ...d, roleIds: toggle(d.roleIds, id) }))} />
        </div>
      )}
      {lists.certifications.length > 0 && (
        <div className="space-y-1">
          <span className="text-sm text-slate-300">הסמכות שיש לך</span>
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
      <Field label="הערות למנהל">
        <textarea rows={3} value={draft.notes ?? ''} onChange={set('notes')} className={inputClass} />
      </Field>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <button type="button" onClick={send} disabled={busy} className="min-h-12 w-full rounded-xl bg-sky-500 font-semibold text-slate-950 disabled:opacity-50">
        {busy ? 'שולח...' : 'שליחה למנהל'}
      </button>
    </main>
  )
}
