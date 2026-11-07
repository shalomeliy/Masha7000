import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Loader2, MessageCircle, Share2, Trash2, UserPlus } from 'lucide-react'
import { Sheet } from '../../components/Sheet'
import { fullName, newId } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import { authMode } from '../../lib/google/auth'
import {
  closeForm,
  formLists,
  joinMessage,
  joinUrl,
  listSubmissions,
  matchWorker,
  openForm,
  removeSubmission,
  workerFromSubmission,
  type Submission,
} from '../../lib/join'
import { whatsappHref } from '../../lib/report'
import type { Worker } from '../../types/models'
import { tx } from '../../i18n'

// The manager's side of the workers' details form: the link to send, and the answers waiting.
// Works only with the server (the live site); answers live there until added or thrown away.

const KEY = ['joinSubmissions']

const joinAvailable = () => authMode() === 'server'

function useJoinSubmissions() {
  return useQuery({ queryKey: KEY, queryFn: listSubmissions, enabled: joinAvailable(), refetchOnWindowFocus: true, staleTime: 30_000 })
}

/** The button that opens the link sheet, under the constraints request. */
export function JoinButton() {
  const [open, setOpen] = useState(false)
  if (!joinAvailable()) return null
  return (
    <>
      <button
        type="button"
        data-hint="joinLink"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-sky-500/50 px-3 text-start text-sm text-sky-300"
      >
        <UserPlus size={16} aria-hidden className="shrink-0" />
        {tx('טופס פרטים לעובדים: שליחת קישור בוואטסאפ')}
      </button>
      <JoinSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function JoinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const roles = useDriveList('roles')
  const certs = useDriveList('certifications')
  const departments = useDriveList('departments')
  const [copied, setCopied] = useState(false)
  const [confirmNew, setConfirmNew] = useState(false)
  const lists = formLists(roles.items, certs.items, departments.items)

  // Opening the sheet opens the form (or keeps it open) with today's roles, certifications and departments.
  const link = useQuery({
    queryKey: ['joinLink', JSON.stringify(lists)],
    queryFn: () => openForm(lists),
    enabled: open,
    staleTime: Infinity,
    gcTime: 0,
  })
  const change = useMutation({
    mutationFn: async (renew: boolean): Promise<unknown> => (renew ? openForm(lists, true) : closeForm()),
    onSuccess: () => {
      setConfirmNew(false)
      setCopied(false)
      void qc.invalidateQueries({ queryKey: ['joinLink'] })
    },
  })
  const closed = change.isSuccess && change.variables === false
  const url = link.data && !closed ? joinUrl(link.data.code) : null
  const text = url ? joinMessage(url) : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  const done = () => {
    change.reset()
    setConfirmNew(false)
    onClose()
  }

  return (
    <Sheet open={open} title={tx('טופס פרטים לעובדים')} onClose={done}>
      <p className="text-sm text-slate-300">
        {tx('שולחים את הקישור לקבוצה. כל עובד ממלא את הפרטים שלו בטלפון, בלי להתחבר לשום דבר. מה שהם שולחים מחכה לך כאן ברשימת העובדים, ואתה מאשר כל אחד לפני שהוא נכנס.')}
      </p>
      {closed ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">{tx('הטופס סגור. מי שינסה לפתוח את הקישור הישן יראה שהוא סגור.')}</p>
      ) : link.isError ? (
        <p role="alert" className="text-sm text-red-300">{(link.error as Error).message}</p>
      ) : !url ? (
        <p className="flex items-center gap-2 text-slate-400">
          <Loader2 className="animate-spin" size={18} aria-hidden />
          {tx('מכין את הקישור...')}
        </p>
      ) : (
        <>
          <pre className="whitespace-pre-wrap break-all rounded-xl border border-slate-800 bg-slate-950 p-3 font-sans text-sm text-slate-200">{text}</pre>
          <a
            href={whatsappHref(text)}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950"
          >
            <MessageCircle size={20} aria-hidden />
            {tx('שליחה בוואטסאפ')}
          </a>
          <div className="flex gap-2">
            {'share' in navigator && (
              <button
                type="button"
                onClick={() => navigator.share({ text }).catch(() => {})}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 text-sm text-slate-200"
              >
                <Share2 size={18} aria-hidden />
                {tx('שיתוף')}
              </button>
            )}
            <button type="button" onClick={copy} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 text-sm text-slate-200">
              <Copy size={18} aria-hidden />
              {copied ? tx('הועתק') : tx('העתקה')}
            </button>
          </div>
        </>
      )}

      {confirmNew ? (
        <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          <p>{tx('הקישור הישן יפסיק לעבוד, וצריך לשלוח לקבוצה את החדש. טפסים שכבר נשלחו נשארים.')}</p>
          <div className="flex gap-2">
            <button type="button" disabled={change.isPending} onClick={() => change.mutate(true)} className="min-h-11 flex-1 rounded-xl bg-amber-400 font-semibold text-slate-950 disabled:opacity-50">
              {tx('כן, קישור חדש')}
            </button>
            <button type="button" onClick={() => setConfirmNew(false)} className="min-h-11 flex-1 rounded-xl border border-slate-700 text-slate-300">
              {tx('ביטול')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={() => setConfirmNew(true)} className="min-h-11 flex-1 rounded-xl border border-slate-700 text-sm text-slate-300">
            {closed ? tx('פתיחה מחדש עם קישור חדש') : tx('קישור חדש')}
          </button>
          {!closed && (
            <button type="button" disabled={change.isPending} onClick={() => change.mutate(false)} className="min-h-11 flex-1 rounded-xl border border-slate-700 text-sm text-slate-300 disabled:opacity-50">
              {tx('סגירת הטופס')}
            </button>
          )}
        </div>
      )}
      {change.isError && <p role="alert" className="text-sm text-red-300">{(change.error as Error).message}</p>}
      <button type="button" onClick={done} className="min-h-12 w-full rounded-xl border border-slate-700 text-slate-300">
        {tx('סגירה')}
      </button>
    </Sheet>
  )
}

/**
 * Answers waiting for the manager. "בדיקה והוספה" opens the usual worker form, filled from the answer
 * (or the existing worker with the answer written in); saving it is the approval.
 */
export function JoinPending({ onReview }: { onReview: (worker: Worker, done: () => void) => void }) {
  const qc = useQueryClient()
  const subs = useJoinSubmissions()
  const workers = useDriveList('workers')
  const [confirming, setConfirming] = useState<string | null>(null)
  const remove = useMutation({
    mutationFn: ({ id, allowAgain }: { id: string; allowAgain: boolean }) => removeSubmission(id, allowAgain),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
  const list = subs.data?.submissions ?? []
  if (!joinAvailable() || list.length === 0) return null

  const review = (s: Submission) => {
    const existing = matchWorker(s, workers.items)
    onReview(workerFromSubmission(s, existing, newId), () => remove.mutate({ id: s.id, allowAgain: false }))
  }

  return (
    <section className="mb-3 space-y-2 rounded-2xl border border-sky-500/40 bg-sky-500/10 p-3" aria-live="polite">
      <h2 className="font-semibold text-sky-200">{list.length === 1 ? tx('עובד אחד מילא את הטופס') : tx('{length} עובדים מילאו את הטופס', { length: list.length })}</h2>
      <p className="text-xs text-slate-400">{tx('בודקים את הפרטים ושומרים, ורק אז העובד נכנס לרשימה.')}</p>
      <ul className="space-y-2">
        {list.map((s) => {
          const existing = matchWorker(s, workers.items)
          return (
            <li key={s.id} className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-3">
              <div>
                <p className="font-medium">{fullName(s)}</p>
                <p dir="ltr" className="text-end text-sm text-slate-400">{s.mobilePhone}</p>
                {existing && <p className="text-xs text-amber-300">{tx('כבר ברשימה בשם {v}. שמירה תעדכן את הפרטים שלו.', { v: fullName(existing) })}</p>}
              </div>
              {confirming === s.id ? (
                <div className="flex gap-2">
                  <button type="button" onClick={() => remove.mutate({ id: s.id, allowAgain: true })} disabled={remove.isPending} className="min-h-11 flex-1 rounded-xl bg-red-500 text-sm font-semibold text-slate-950 disabled:opacity-50">
                    {tx('כן, למחוק (יוכל למלא שוב)')}
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} className="min-h-11 flex-1 rounded-xl border border-slate-700 text-sm text-slate-300">
                    {tx('ביטול')}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button type="button" onClick={() => review(s)} className="min-h-11 flex-1 rounded-xl bg-sky-500 text-sm font-semibold text-slate-950">
                    {existing ? tx('בדיקה ועדכון') : tx('בדיקה והוספה')}
                  </button>
                  <button type="button" aria-label={tx('מחיקת הטופס של {v}', { v: fullName(s) })} onClick={() => setConfirming(s.id)} className="flex min-h-11 w-11 items-center justify-center rounded-xl border border-slate-700 text-slate-300">
                    <Trash2 size={18} aria-hidden />
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {remove.isError && <p role="alert" className="text-sm text-red-300">{(remove.error as Error).message}</p>}
    </section>
  )
}
