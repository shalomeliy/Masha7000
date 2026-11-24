import { tx } from '../../i18n'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Sparkles, Trash2, X } from 'lucide-react'
import { approveCustomer, loadCustomers, PLAN_LIMITS, rejectCustomer, removeCustomer, setCustomerClaude, setCustomerLimit, type Customers } from '../../lib/google/owner'

// The app owner (smart onboarding part 2): new customers asking for access, and the approved ones.
// Each customer works on his own Google Drive; the owner sets how many managers he may have
// (1 / 10 / 30, the plans), and whether his Shali may ask Claude (the owner's budget, also the cloud voice).

const planName = (n: number) => (n === 1 ? tx('קטן') : n === 10 ? tx('בינוני') : tx('גדול'))

export function CustomersSection() {
  const qc = useQueryClient()
  const data = useQuery({ queryKey: ['customers'], queryFn: loadCustomers })
  const [plan, setPlan] = useState<Record<string, number>>({})
  const [confirm, setConfirm] = useState<string | null>(null)
  const done = (c: Customers) => {
    qc.setQueryData(['customers'], c)
    setConfirm(null)
  }
  const act = useMutation({
    mutationFn: (a: { kind: 'approve' | 'reject' | 'claude' | 'limit' | 'remove'; key: string; n?: number; on?: boolean }) =>
      a.kind === 'approve'
        ? approveCustomer(a.key, a.n!)
        : a.kind === 'reject'
          ? rejectCustomer(a.key)
          : a.kind === 'claude'
            ? setCustomerClaude(a.key, a.on!)
            : a.kind === 'limit'
              ? setCustomerLimit(a.key, a.n!)
              : removeCustomer(a.key),
    onSuccess: done,
  })

  if (data.isPending)
    return (
      <p className="flex items-center gap-2 text-slate-400">
        <Loader2 className="animate-spin" size={18} aria-hidden />
        {tx('טוען...')}
      </p>
    )
  if (data.isError)
    return (
      <p role="alert" className="text-sm text-red-400">
        {(data.error as Error).message}
      </p>
    )
  const { requests, teams } = data.data
  const planButtons = (current: number, pick: (n: number) => void) => (
    <div className="flex gap-1" role="group" aria-label={tx('מנוי')}>
      {PLAN_LIMITS.map((n) => (
        <button key={n} type="button" aria-pressed={current === n} onClick={() => pick(n)} className={`min-h-11 rounded-lg px-3 text-sm ${current === n ? 'bg-sky-500/20 text-sky-200' : 'text-slate-400'}`}>
          {tx('{plan} ({n})', { plan: planName(n), n })}
        </button>
      ))}
    </div>
  )

  return (
    <div className="space-y-3 pt-4">
      <h3 className="font-semibold">{tx('בקשות גישה')}</h3>
      {requests.length === 0 ? (
        <p className="text-sm text-slate-500">{tx('אין בקשות חדשות.')}</p>
      ) : (
        <ul className="space-y-2">
          {requests.map((r) => {
            const n = plan[r.email] ?? 1
            return (
              <li key={r.email} className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-3 text-sm">
                <p className="font-semibold">{r.businessName}</p>
                <p className="text-slate-400" dir="ltr">
                  {r.email} · {r.whatsapp}
                </p>
                <p className="text-xs text-slate-500">{tx('כמה מנהלים, כולל הלקוח עצמו:')}</p>
                {planButtons(n, (v) => setPlan({ ...plan, [r.email]: v }))}
                <div className="flex gap-2">
                  <button type="button" disabled={act.isPending} onClick={() => act.mutate({ kind: 'approve', key: r.email, n })} className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-500 font-semibold text-slate-950 disabled:opacity-50">
                    <Check size={16} aria-hidden />
                    {tx('אשר')}
                  </button>
                  <button
                    type="button"
                    disabled={act.isPending}
                    onClick={() => (confirm === `reject:${r.email}` ? act.mutate({ kind: 'reject', key: r.email }) : setConfirm(`reject:${r.email}`))}
                    className={`flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border ${confirm === `reject:${r.email}` ? 'border-red-500 bg-red-500/20 text-red-200' : 'border-slate-700 text-slate-300'}`}
                  >
                    <X size={16} aria-hidden />
                    {confirm === `reject:${r.email}` ? tx('לדחות? לחץ שוב') : tx('דחה')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <h3 className="pt-2 font-semibold">{tx('לקוחות')}</h3>
      {teams.length === 0 ? (
        <p className="text-sm text-slate-500">{tx('עוד אין לקוחות.')}</p>
      ) : (
        <ul className="space-y-2">
          {teams.map((t) => (
            <li key={t.id} className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-3 text-sm">
              <p className="font-semibold">{t.businessName}</p>
              <p className="text-slate-400" dir="ltr">
                {t.owner} · {t.whatsapp}
              </p>
              <p className="text-xs text-slate-500">{tx('{used} מתוך {max} מנהלים', { used: t.managers.length + 1, max: t.maxManagers })}</p>
              {planButtons(t.maxManagers, (n) => act.mutate({ kind: 'limit', key: t.id, n }))}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={t.claude}
                  disabled={act.isPending}
                  onClick={() => act.mutate({ kind: 'claude', key: t.id, on: !t.claude })}
                  className={`flex min-h-11 items-center gap-1 rounded-lg px-3 ${t.claude ? 'bg-amber-400/20 text-amber-200' : 'text-slate-400'}`}
                >
                  <Sparkles size={16} aria-hidden />
                  {tx('גם Claude')}
                </button>
                <button
                  type="button"
                  disabled={act.isPending}
                  onClick={() => (confirm === `remove:${t.id}` ? act.mutate({ kind: 'remove', key: t.id }) : setConfirm(`remove:${t.id}`))}
                  className={`flex min-h-11 items-center gap-1 rounded-lg px-3 ${confirm === `remove:${t.id}` ? 'bg-red-500/20 text-red-300' : 'text-slate-400'}`}
                >
                  <Trash2 size={16} aria-hidden />
                  {confirm === `remove:${t.id}` ? tx('להסיר את הלקוח? לחץ שוב') : tx('הסרת לקוח')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">{tx('כל לקוח עובד על הגוגל דרייב שלו ורואה רק את הנתונים שלו. "גם Claude": ה-Shali שלו פונה גם ל-Claude ומדבר בקול הענן, מהתקציב החודשי שלך. בלי זה: פקודות חינמיות בלבד, בקול של הטלפון.')}</p>
      <p className="text-xs text-slate-500">{tx('הסרת לקוח מנתקת אותו ואת המנהלים שלו מכל המכשירים ומבטלת את הגישה לדרייב שלו. הנתונים נשארים אצלו בדרייב.')}</p>
      {act.isError && (
        <p role="alert" className="text-sm text-red-400">
          {(act.error as Error).message}
        </p>
      )}
    </div>
  )
}
