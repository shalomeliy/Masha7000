import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { tx } from '../i18n'
import { inputClass } from '../components/Sheet'
import { isWhatsapp, loadApplicant, sendAccessRequest, type Applicant } from '../lib/accessRequest'

// "לקוח חדש? בקש גישה" (smart onboarding part 2), on the sign-in screen right after Google said who
// you are and that email is in no team. The owner approves in Settings > מי יכול להיכנס; then the
// new customer signs in, sets up two-step, and links his own Google Drive.

export function AccessRequest() {
  const [applicant, setApplicant] = useState<Applicant | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadApplicant().then(setApplicant)
  }, [])

  if (!applicant) return <Loader2 className="mx-auto animate-spin text-slate-400" size={20} aria-label={tx('טוען...')} />
  // No Google sign-in to go with (it was more than half an hour ago): nothing to fill here.
  if (!applicant.email) return null
  if (done || applicant.sent)
    return (
      <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
        {tx('הבקשה נשלחה. כשהיא תאושר, נכנסים כאן עם אותו מייל, מגדירים אימות דו-שלבי ומחברים את הגוגל דרייב שלך.')}
      </p>
    )

  const nameOk = name.trim().length >= 2
  const phoneOk = isWhatsapp(phone)
  return (
    <form
      className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4"
      onSubmit={async (ev) => {
        ev.preventDefault()
        if (!nameOk || !phoneOk) return
        setBusy(true)
        setError(null)
        try {
          await sendAccessRequest(name.trim(), phone)
          setDone(true)
        } catch (e) {
          setError((e as Error).message)
        } finally {
          setBusy(false)
        }
      }}
    >
      <h2 className="font-semibold">{tx('לקוח חדש? בקש גישה')}</h2>
      <p className="text-sm text-slate-400">
        {tx('הבקשה נשלחת למנהל המערכת עם המייל שהתחברת בו:')}{' '}
        <span dir="ltr">{applicant.email}</span>
      </p>
      <label className="block space-y-1 text-sm">
        <span>{tx('שם העסק')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="organization" className={`${inputClass} w-full`} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>{tx('וואטסאפ')}</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" autoComplete="tel" placeholder="05X-XXXXXXX" className={`${inputClass} w-full`} />
      </label>
      {phone && !phoneOk && <p className="text-xs text-amber-200">{tx('מספר וואטסאפ צריך להיות נייד, 05X.')}</p>}
      <button type="submit" disabled={busy || !nameOk || !phoneOk} className="min-h-11 w-full rounded-xl bg-sky-500 font-semibold text-slate-950 disabled:opacity-50">
        {busy ? tx('שולח...') : tx('שליחת בקשה')}
      </button>
      <p className="text-xs text-slate-500">{tx('אחרי אישור, הנתונים שלך נשמרים בגוגל דרייב שלך בלבד. אף לקוח אחר לא רואה אותם.')}</p>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </form>
  )
}
