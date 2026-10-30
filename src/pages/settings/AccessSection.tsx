import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2 } from 'lucide-react'
import { inputClass } from '../../components/Sheet'
import { addAccess, disconnectDrive, listAccess, removeAccess } from '../../lib/google/owner'
import type { AccessList } from '../../lib/google/owner'
import { useAuth } from '../../store/auth'

// Owner only: who may sign in (they all see and edit the owner's data), and disconnecting the Drive.

export function AccessSection() {
  const qc = useQueryClient()
  const access = useQuery({ queryKey: ['access'], queryFn: listAccess })
  const [email, setEmail] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null) // email awaiting a second tap, or 'disconnect'
  const change = useMutation({
    mutationFn: ({ action, email }: { action: 'add' | 'remove'; email: string }) =>
      action === 'add' ? addAccess(email) : removeAccess(email),
    onSuccess: (list: AccessList, { action }) => {
      qc.setQueryData(['access'], list)
      setConfirm(null)
      if (action === 'add') setEmail('')
    },
  })
  const disconnect = useMutation({
    mutationFn: disconnectDrive,
    onSuccess: () => useAuth.setState({ status: 'ownerDisconnected' }),
  })

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">מי יכול להיכנס</h2>
      <p className="text-sm text-slate-400">
        כל מייל ברשימה נכנס עם חשבון הגוגל שלו ורואה ועורך את אותם נתונים, מהדרייב שלך. מי שנמחק מהרשימה יוצא תוך שעה לכל היותר.
      </p>

      {access.isPending ? (
        <p className="flex items-center gap-2 text-slate-400">
          <Loader2 className="animate-spin" size={18} aria-hidden />
          טוען...
        </p>
      ) : access.isError ? (
        <p role="alert" className="text-sm text-red-400">
          {(access.error as Error).message}
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
          <li className="flex min-h-12 items-center px-4 text-sm">
            <span className="flex-1 truncate" dir="ltr">
              {access.data.owner}
            </span>
            <span className="text-slate-400">אתה (המנהל)</span>
          </li>
          {access.data.emails.map((e) => (
            <li key={e} className="flex min-h-12 items-center gap-2 px-4 text-sm">
              <span className="flex-1 truncate" dir="ltr">
                {e}
              </span>
              <button
                type="button"
                disabled={change.isPending}
                onClick={() => (confirm === e ? change.mutate({ action: 'remove', email: e }) : setConfirm(e))}
                className={`flex min-h-11 items-center gap-1 rounded-lg px-3 ${confirm === e ? 'bg-red-500/20 text-red-300' : 'text-slate-400'}`}
              >
                <Trash2 size={16} aria-hidden />
                {confirm === e ? 'למחוק? לחץ שוב' : 'מחיקה'}
              </button>
            </li>
          ))}
        </ul>
      )}

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
          aria-label="מייל להוספה"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${inputClass} flex-1`}
        />
        <button type="submit" disabled={change.isPending || !email.trim()} className="min-h-11 rounded-xl bg-sky-500 px-4 font-semibold text-slate-950 disabled:opacity-50">
          הוספה
        </button>
      </form>
      {change.isError && (
        <p role="alert" className="text-sm text-red-400">
          {(change.error as Error).message}
        </p>
      )}

      <div className="space-y-2 pt-2">
        <button
          type="button"
          disabled={disconnect.isPending}
          onClick={() => (confirm === 'disconnect' ? disconnect.mutate() : setConfirm('disconnect'))}
          className={`w-full rounded-xl border py-3 ${confirm === 'disconnect' ? 'border-red-500 bg-red-500/20 text-red-200' : 'border-slate-700 text-slate-300'}`}
        >
          {confirm === 'disconnect' ? 'לנתק לכולם? לחץ שוב' : 'ניתוק הדרייב'}
        </button>
        <p className="text-xs text-slate-500">מנתק את הגישה של האפליקציה לדרייב שלך, לכל המשתמשים, עד שתתחבר מחדש. הנתונים עצמם לא נמחקים.</p>
        {disconnect.isError && (
          <p role="alert" className="text-sm text-red-400">
            {(disconnect.error as Error).message}
          </p>
        )}
      </div>
    </div>
  )
}
