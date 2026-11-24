import { tx } from '../../i18n'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { inputClass } from '../../components/Sheet'
import { addTeamAccess, disconnectDrive, listTeamAccess, removeTeamAccess, type TeamAccessList } from '../../lib/google/owner'
import { resetMfaOf } from '../../lib/google/mfa'
import { useAuth } from '../../store/auth'

// A customer team's owner (smart onboarding part 2): the managers of his own team, on his own Drive,
// up to his plan (the owner included). Removing one signs him out everywhere at once.

export function TeamAccessSection() {
  const qc = useQueryClient()
  const access = useQuery({ queryKey: ['team-access'], queryFn: listTeamAccess })
  const [email, setEmail] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [resetDone, setResetDone] = useState<string | null>(null)
  const change = useMutation({
    mutationFn: ({ action, email }: { action: 'add' | 'remove'; email: string }) => (action === 'add' ? addTeamAccess(email) : removeTeamAccess(email)),
    onSuccess: (list: TeamAccessList, { action }) => {
      qc.setQueryData(['team-access'], list)
      setConfirm(null)
      if (action === 'add') setEmail('')
    },
  })
  const reset = useMutation({
    mutationFn: resetMfaOf,
    onSuccess: (_r, e) => {
      setConfirm(null)
      setResetDone(e)
    },
  })
  const disconnect = useMutation({ mutationFn: disconnectDrive, onSuccess: () => useAuth.setState({ status: 'ownerDisconnected' }) })
  const used = access.data ? access.data.emails.length + 1 : 0
  const full = access.data ? used >= access.data.maxManagers : false

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{tx('מי יכול להיכנס')}</h2>
      <p className="text-sm text-slate-400">{tx('המנהלים ברשימה נכנסים עם חשבון הגוגל שלהם ועובדים על הנתונים של הצוות שלך, מהדרייב שלך. מי שנמחק מנותק מיד מכל המכשירים.')}</p>
      {access.isPending ? (
        <p className="flex items-center gap-2 text-slate-400">
          <Loader2 className="animate-spin" size={18} aria-hidden />
          {tx('טוען...')}
        </p>
      ) : access.isError ? (
        <p role="alert" className="text-sm text-red-400">
          {(access.error as Error).message}
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-300">{tx('{used} מתוך {max} מנהלים במנוי שלך', { used, max: access.data.maxManagers })}</p>
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            <li className="flex min-h-12 items-center px-4 text-sm">
              <span className="flex-1 truncate" dir="ltr">
                {access.data.owner}
              </span>
              <span className="text-slate-400">{tx('אתה (המנהל)')}</span>
            </li>
            {access.data.emails.map((e) => (
              <li key={e} className="flex min-h-12 flex-wrap items-center gap-2 px-4 py-1 text-sm">
                <span className="min-w-0 flex-1 truncate" dir="ltr">
                  {e}
                </span>
                <button
                  type="button"
                  disabled={reset.isPending}
                  onClick={() => (confirm === `reset:${e}` ? reset.mutate(e) : setConfirm(`reset:${e}`))}
                  className={`flex min-h-11 items-center gap-1 rounded-lg px-3 ${confirm === `reset:${e}` ? 'bg-amber-500/20 text-amber-200' : 'text-slate-400'}`}
                >
                  <RotateCcw size={16} aria-hidden />
                  {confirm === `reset:${e}` ? tx('לאפס? לחץ שוב') : resetDone === e ? tx('אופס') : tx('איפוס אימות')}
                </button>
                <button
                  type="button"
                  disabled={change.isPending}
                  onClick={() => (confirm === e ? change.mutate({ action: 'remove', email: e }) : setConfirm(e))}
                  className={`flex min-h-11 items-center gap-1 rounded-lg px-3 ${confirm === e ? 'bg-red-500/20 text-red-300' : 'text-slate-400'}`}
                >
                  <Trash2 size={16} aria-hidden />
                  {confirm === e ? tx('למחוק? לחץ שוב') : tx('מחיקה')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {full ? (
        <p className="text-xs text-slate-500">{tx('הגעת למספר המנהלים של המנוי שלך. למנוי גדול יותר, פנה למנהל המערכת.')}</p>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(ev) => {
            ev.preventDefault()
            if (email.trim()) change.mutate({ action: 'add', email })
          }}
        >
          <input
            type="email"
            dir="ltr"
            inputMode="email"
            autoComplete="off"
            placeholder="name@gmail.com"
            aria-label={tx('מייל להוספה')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} flex-1`}
          />
          <button type="submit" disabled={change.isPending || !email.trim()} className="min-h-11 rounded-xl bg-sky-500 px-4 font-semibold text-slate-950 disabled:opacity-50">
            {tx('הוספה')}
          </button>
        </form>
      )}
      {access.data && !access.data.claude && <p className="text-xs text-slate-500">{tx('Shali עובד אצלכם בפקודות החינמיות, בקול של הטלפון.')}</p>}
      {[change, reset, disconnect].map((m, i) =>
        m.isError ? (
          <p key={i} role="alert" className="text-sm text-red-400">
            {(m.error as Error).message}
          </p>
        ) : null,
      )}
      <div className="space-y-2 pt-2">
        <button
          type="button"
          disabled={disconnect.isPending}
          onClick={() => (confirm === 'disconnect' ? disconnect.mutate() : setConfirm('disconnect'))}
          className={`w-full rounded-xl border py-3 ${confirm === 'disconnect' ? 'border-red-500 bg-red-500/20 text-red-200' : 'border-slate-700 text-slate-300'}`}
        >
          {confirm === 'disconnect' ? tx('לנתק לכולם? לחץ שוב') : tx('ניתוק הדרייב')}
        </button>
        <p className="text-xs text-slate-500">{tx('מנתק את הגישה של האפליקציה לדרייב שלך, לכל המשתמשים, עד שתתחבר מחדש. הנתונים עצמם לא נמחקים.')}</p>
      </div>
    </div>
  )
}
