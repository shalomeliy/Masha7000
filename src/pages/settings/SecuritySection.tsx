import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { mfaStatus, logoutEverywhere, newRecoveryCodes } from '../../lib/google/mfa'
import { useAuth } from '../../store/auth'
import { RecoveryCodes } from '../../components/RecoveryCodes'

// Server mode: the person's own two-step backup codes, and signing out on every device at once
// (for a lost or stolen phone or computer).

export function SecuritySection() {
  const status = useQuery({ queryKey: ['mfaStatus'], queryFn: mfaStatus })
  const [codes, setCodes] = useState<string[] | null>(null)
  const [confirm, setConfirm] = useState<'codes' | 'everywhere' | null>(null)
  const fresh = useMutation({
    mutationFn: newRecoveryCodes,
    onSuccess: (r) => {
      setCodes(r.recoveryCodes)
      setConfirm(null)
    },
  })
  const everywhere = useMutation({
    mutationFn: logoutEverywhere,
    onSuccess: () => useAuth.setState({ status: 'signedOut', who: null }),
  })
  const error = (fresh.error ?? everywhere.error) as Error | null

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">אבטחה</h2>
      {codes ? (
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            setCodes(null)
            void status.refetch()
          }}
        />
      ) : (
        <>
          <p className="text-sm text-slate-400">
            הכניסה מוגנת באימות דו-שלבי.{' '}
            {status.data ? `נשארו לך ${status.data.recoveryLeft} קודי גיבוי.` : ''}
          </p>
          <button
            type="button"
            disabled={fresh.isPending}
            onClick={() => (confirm === 'codes' ? fresh.mutate() : setConfirm('codes'))}
            className={`w-full rounded-xl border py-3 ${confirm === 'codes' ? 'border-amber-500 bg-amber-500/10 text-amber-200' : 'border-slate-700 text-slate-300'}`}
          >
            {confirm === 'codes' ? 'הקודים הישנים יפסיקו לעבוד. לחץ שוב' : 'קודי גיבוי חדשים'}
          </button>
        </>
      )}
      <button
        type="button"
        disabled={everywhere.isPending}
        onClick={() => (confirm === 'everywhere' ? everywhere.mutate() : setConfirm('everywhere'))}
        className={`w-full rounded-xl border py-3 ${confirm === 'everywhere' ? 'border-red-500 bg-red-500/20 text-red-200' : 'border-slate-700 text-slate-300'}`}
      >
        {confirm === 'everywhere' ? 'לנתק את כל המכשירים שלך? לחץ שוב' : 'ניתוק מכל המכשירים'}
      </button>
      <p className="text-xs text-slate-500">לטלפון או מחשב שאבד: מנתק את החשבון שלך בכל מקום, גם כאן. אחר כך נכנסים מחדש עם גוגל וקוד.</p>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error.message}
        </p>
      )}
      <p className="text-sm">
        <a href="/privacy.html" className="text-sky-300 underline">
          מדיניות פרטיות
        </a>
        {' · '}
        <a href="/terms.html" className="text-sky-300 underline">
          תנאי שימוש
        </a>
      </p>
    </div>
  )
}
