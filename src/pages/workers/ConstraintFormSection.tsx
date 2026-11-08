import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarX, ChevronLeft, ChevronRight, Copy, Loader2, MessageCircle, Share2 } from 'lucide-react'
import { Sheet } from '../../components/Sheet'
import { fullName } from '../../lib/catalog'
import {
  applyAnswers,
  closeConstraintForm,
  constraintFormMessage,
  constraintFormUrl,
  listConstraintAnswers,
  openConstraintForm,
  removeConstraintAnswers,
  rosterOf,
  withoutMobile,
} from '../../lib/constraintForm'
import { useDriveList } from '../../lib/data/useDriveList'
import { todayIso } from '../../lib/dates'
import { authMode } from '../../lib/google/auth'
import { whatsappHref } from '../../lib/report'
import { addDays, showDate, weekOf } from '../../lib/shifts'
import { tx } from '../../i18n'

// The manager's side of the weekly constraints form: open it for a week, send the link, see who
// answered. Answers are written into the workers' constraints by `ConstraintAnswersSync`, which
// runs in the background on every screen. Works only with the server (the live site).

const KEY = ['constraintForm']
const available = () => authMode() === 'server'

const useFormState = () =>
  useQuery({ queryKey: KEY, queryFn: listConstraintAnswers, enabled: available(), refetchOnWindowFocus: true, refetchInterval: 60_000, staleTime: 20_000 })

/**
 * Writes waiting answers into the workers' constraints, then removes them from the server. Mounted
 * once in the app, so answers land while the manager uses any screen.
 */
export function ConstraintAnswersSync() {
  const qc = useQueryClient()
  const state = useFormState()
  const workers = useDriveList('workers')
  const busy = useRef(false)
  const answers = state.data?.answers

  // One try per answers read from the server: a failed save waits for the next check, not the next render.
  const tried = useRef(0)
  useEffect(() => {
    if (busy.current || !answers?.length || !workers.query.isSuccess || workers.saving || tried.current === state.dataUpdatedAt) return
    busy.current = true
    tried.current = state.dataUpdatedAt
    const { workers: next, used } = applyAnswers(workers.items, answers)
    void workers
      .save(next)
      .then(() => removeConstraintAnswers(used))
      .then(() => qc.invalidateQueries({ queryKey: KEY }))
      .catch(() => {
        // Not saved or not removed: the answers wait on the server and are tried again on the next check
        // (writing the same week's answer twice gives the same constraints).
      })
      .finally(() => {
        busy.current = false
      })
  }, [answers, workers, qc, state.dataUpdatedAt])
  return null
}

/** The constraints tab: the week, the link to send, and who answered. */
export function ConstraintFormPanel() {
  const qc = useQueryClient()
  const state = useFormState()
  const workers = useDriveList('workers')
  const [week, setWeek] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{ code: string; week: string } | null>(null)
  const [confirmNew, setConfirmNew] = useState(false)
  const roster = rosterOf(workers.items)
  const openWeek = state.data?.code ? state.data.weekStart : null
  const shownWeek = week ?? openWeek ?? addDays(weekOf(todayIso()).start, 7)

  const change = useMutation({
    mutationFn: async (what: 'send' | 'renew' | 'close') =>
      what === 'close' ? closeConstraintForm() : openConstraintForm(shownWeek, roster, what === 'renew'),
    onSuccess: (r, what) => {
      setConfirmNew(false)
      if (what !== 'close' && r.code) setSheet({ code: r.code, week: shownWeek })
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })

  // The form keeps the roster the app sent when it was opened: refresh it when the workers list
  // changed (a new worker, a new number), so they are recognized too.
  const rosterKey = JSON.stringify(roster)
  const sentRoster = useRef<string | null>(null)
  useEffect(() => {
    if (!openWeek || !workers.query.isSuccess || sentRoster.current === rosterKey) return
    sentRoster.current = rosterKey
    void openConstraintForm(openWeek, roster).catch(() => {
      sentRoster.current = null
    })
  }, [openWeek, rosterKey, workers.query.isSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!available())
    return <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">{tx('הטופס עובד רק באתר החי של האפליקציה.')}</p>

  const answered = new Set(state.data?.answered ?? [])
  const known = workers.items.filter((w) => roster.some((r) => r.id === w.id))
  const done = known.filter((w) => answered.has(w.id))
  const waiting = known.filter((w) => !answered.has(w.id))
  const noMobile = withoutMobile(workers.items)
  const names = (list: typeof known) => list.map(fullName).sort((a, b) => a.localeCompare(b, 'he')).join(', ')
  const isOpenWeek = openWeek === shownWeek

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl bg-slate-900 p-1">
        <button type="button" aria-label={tx('שבוע קודם')} onClick={() => setWeek(addDays(shownWeek, -7))} className="flex size-11 items-center justify-center text-slate-300">
          <ChevronRight size={20} aria-hidden />
        </button>
        <span className="text-sm font-medium">{tx('שבוע {v} עד {v2}', { v: showDate(shownWeek), v2: showDate(addDays(shownWeek, 6)) })}</span>
        <button type="button" aria-label={tx('שבוע הבא')} onClick={() => setWeek(addDays(shownWeek, 7))} className="flex size-11 items-center justify-center text-slate-300">
          <ChevronLeft size={20} aria-hidden />
        </button>
      </div>

      <button
        type="button"
        data-hint="requestConstraints"
        disabled={change.isPending || !workers.query.isSuccess}
        onClick={() => change.mutate('send')}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950 disabled:opacity-50"
      >
        {change.isPending ? <Loader2 size={20} aria-hidden className="animate-spin" /> : <CalendarX size={20} aria-hidden className="shrink-0" />}
        {tx('שליחת טופס אילוצים בוואטסאפ')}
      </button>
      {openWeek && !isOpenWeek && (
        <p className="text-xs text-amber-300">
          {tx('הטופס פתוח עכשיו לשבוע {v}. שליחה תעביר אותו לשבוע שבחרת, באותו קישור.', { v: showDate(openWeek) })}
        </p>
      )}

      {state.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="animate-spin" size={16} aria-hidden />
          {tx('בודק מי ענה...')}
        </p>
      ) : state.isError ? (
        <p role="alert" className="text-sm text-red-300">{(state.error as Error).message}</p>
      ) : openWeek ? (
        <section className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-3" aria-live="polite">
          <h2 className="font-semibold">{tx('הטופס פתוח לשבוע {v} עד {v2}', { v: showDate(openWeek), v2: showDate(addDays(openWeek, 6)) })}</h2>
          <p className="text-sm text-emerald-300">{tx('ענו {v} מתוך {v2}', { v: done.length, v2: known.length })}{done.length > 0 && `: ${names(done)}`}</p>
          {waiting.length > 0 && <p className="text-sm text-slate-300">{tx('עוד לא ענו: {v}', { v: names(waiting) })}</p>}
          <p className="text-xs text-slate-400">{tx('מה שעובד שולח נכנס לבד לאילוצים שלו. אם הוא שולח שוב לאותו שבוע, התשובה החדשה מחליפה את הקודמת.')}</p>
          {confirmNew ? (
            <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              <p>{tx('הקישור הישן יפסיק לעבוד, וצריך לשלוח לקבוצה את החדש.')}</p>
              <div className="flex gap-2">
                <button type="button" disabled={change.isPending} onClick={() => change.mutate('renew')} className="min-h-11 flex-1 rounded-xl bg-amber-400 font-semibold text-slate-950 disabled:opacity-50">
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
                {tx('קישור חדש')}
              </button>
              <button type="button" disabled={change.isPending} onClick={() => change.mutate('close')} className="min-h-11 flex-1 rounded-xl border border-slate-700 text-sm text-slate-300 disabled:opacity-50">
                {tx('סגירת הטופס')}
              </button>
            </div>
          )}
        </section>
      ) : (
        <p className="text-sm text-slate-400">{tx('הטופס סגור. לחיצה על השליחה פותחת אותו לשבוע שבחרת.')}</p>
      )}

      {noMobile.length > 0 && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          {tx('לעובדים האלה אין נייד תקין ברשימה, אז הטופס לא יזהה אותם: {v}. מוסיפים להם נייד בכרטיס העובד.', { v: names(noMobile) })}
        </p>
      )}
      {change.isError && <p role="alert" className="text-sm text-red-300">{(change.error as Error).message}</p>}

      <LinkSheet sent={sheet} onClose={() => setSheet(null)} />
    </div>
  )
}

function LinkSheet({ sent, onClose }: { sent: { code: string; week: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const text = sent ? constraintFormMessage(constraintFormUrl(sent.code), sent.week) : ''
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  const close = () => {
    setCopied(false)
    onClose()
  }
  return (
    <Sheet open={!!sent} title={tx('טופס אילוצים לעובדים')} onClose={close}>
      <p className="text-sm text-slate-300">{tx('שולחים את ההודעה לקבוצה. כל עובד ממלא בטלפון את המספר שלו ואת הימים שאין לו אפשרות, ולוחץ שליחה. זה נכנס לבד לאילוצים שלו.')}</p>
      <pre className="whitespace-pre-wrap break-all rounded-xl border border-slate-800 bg-slate-950 p-3 font-sans text-sm text-slate-200">{text}</pre>
      <a href={whatsappHref(text)} target="_blank" rel="noreferrer" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950">
        <MessageCircle size={20} aria-hidden />
        {tx('שליחה בוואטסאפ')}
      </a>
      <div className="flex gap-2">
        {'share' in navigator && (
          <button type="button" onClick={() => navigator.share({ text }).catch(() => {})} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 text-sm text-slate-200">
            <Share2 size={18} aria-hidden />
            {tx('שיתוף')}
          </button>
        )}
        <button type="button" onClick={copy} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 text-sm text-slate-200">
          <Copy size={18} aria-hidden />
          {copied ? tx('הועתק') : tx('העתקה')}
        </button>
      </div>
      <button type="button" onClick={close} className="min-h-12 w-full rounded-xl border border-slate-700 text-slate-300">
        {tx('סגירה')}
      </button>
    </Sheet>
  )
}
