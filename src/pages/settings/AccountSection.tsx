import { tx } from '../../i18n'
import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import { inputClass } from '../../components/Sheet'
import { hasAiConsent, onAiConsent, setAiConsent } from '../../lib/aiConsent'
import { deleteMyAccount, deletesTeamData } from '../../lib/deleteAccount'
import { authMode } from '../../lib/google/auth'
import { useAuth } from '../../store/auth'

// Settings > החשבון שלי: who is signed in, sign out, the yes for sending to an outside AI, and deleting
// the account (both stores require it inside the app; the web page is public/delete-account.html).

const WORD = tx('מחק')

export function AccountSection() {
  const logout = useAuth((s) => s.logout)
  const who = useAuth((s) => s.who)
  const [consent, setConsent] = useState(hasAiConsent)
  useEffect(() => onAiConsent(setConsent), [])
  const [asking, setAsking] = useState(false)
  const [typed, setTyped] = useState('')
  const team = deletesTeamData()
  const remove = useMutation({ mutationFn: deleteMyAccount })

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">{tx('החשבון שלי')}</h1>
      {who && (
        <p className="text-sm text-slate-400">
          {tx('מחובר כ-')}<span dir="ltr">{who.email}</span>
        </p>
      )}
      <button type="button" onClick={logout} className="w-full rounded-xl border border-slate-700 py-3 text-slate-300">
        {tx('התנתקות')}
      </button>
      {authMode() === 'server' && <p className="text-xs text-slate-500">{tx('מנתק רק את המכשיר הזה. שאר המכשירים נשארים מחוברים.')}</p>}

      <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldCheck size={18} aria-hidden className="text-sky-300" />
          {tx('שליחה ל-Claude ול-Google')}
        </h2>
        <p className="text-sm text-slate-400">
          {consent
            ? tx('אישרת ש-Shali ישלח ל-Claude את מה שאומרים לו ואת רשימות העבודה, ול-Google את המשפטים שהוא אומר בקול.')
            : tx('לא אישרת. Shali עושה רק את מה שהוא יודע לבד, ומדבר בקול של הטלפון. הוא ישאל שוב כשיצטרך את Claude.')}
        </p>
        {consent && (
          <button type="button" onClick={() => setAiConsent(false)} className="min-h-11 w-full rounded-xl border border-slate-700 text-slate-300">
            {tx('ביטול האישור')}
          </button>
        )}
      </div>

      <div className="space-y-2 rounded-2xl border border-red-900/60 bg-slate-900 p-4">
        <h2 className="font-semibold text-red-300">{tx('מחיקת החשבון')}</h2>
        <p className="text-sm text-slate-400">
          {team
            ? tx('נמחקים לצמיתות: כל הנתונים של האפליקציה בגוגל דרייב (עובדים, עבודות, רכבים, הגדרות), היומן Smart Shifts, הגישה של כל המנהלים שהוספת, ומה שהשרת שומר. אי אפשר לבטל. כדאי לשמור גיבוי קודם.')
            : tx('נמחקים: הגישה שלך לאפליקציה, החיבורים שלך בכל המכשירים והאימות הדו-שלבי שלך. הנתונים של הצוות נשארים אצל המנהל הראשי.')}
        </p>
        {!asking ? (
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-700 text-red-300"
          >
            <Trash2 size={18} aria-hidden />
            {tx('מחיקת החשבון שלי')}
          </button>
        ) : (
          <div className="space-y-2">
            {team && (
              <label className="block text-sm text-slate-300">
                {tx('כדי לאשר, כתוב: {word}', { word: WORD })}
                <input value={typed} onChange={(e) => setTyped(e.target.value)} className={`${inputClass} mt-1`} autoComplete="off" />
              </label>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => remove.mutate()}
                disabled={remove.isPending || (team && typed.trim() !== WORD)}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 font-semibold text-white disabled:opacity-50"
              >
                {remove.isPending && <Loader2 size={18} className="animate-spin" aria-hidden />}
                {tx('כן, למחוק לצמיתות')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAsking(false)
                  setTyped('')
                }}
                disabled={remove.isPending}
                className="min-h-11 flex-1 rounded-xl border border-slate-700 text-slate-300"
              >
                {tx('ביטול')}
              </button>
            </div>
          </div>
        )}
        {remove.isError && (
          <p role="alert" className="text-sm text-amber-300">
            {tx('המחיקה לא הושלמה: {error}', { error: (remove.error as Error).message })}
          </p>
        )}
      </div>
    </div>
  )
}
