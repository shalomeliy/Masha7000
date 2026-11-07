import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, BookMarked, Check, Gauge, Keyboard, Loader2, Mic, MessageSquareText, Pencil, Square, Trash2 } from 'lucide-react'
import { inputClass } from '../components/Sheet'
import { applyProposal, isYes, MAX_EXAMPLES, normalizeProposal, proposalConflicts, proposalErrors, snapshot, summaryWithConflicts, type AppData, type Proposal, type Screen } from '../lib/assistant'
import { newId } from '../lib/catalog'
import type { Edits } from '../lib/assistantEdits'
import { optionsText, preferenceLesson, solve, type OptionKind, type Problem, type SolverOption } from '../lib/solvers'
import { askAssistant, userTurn, type AssistantAnswer, type Turn } from '../lib/assistantApi'
import { useDriveList } from '../lib/data/useDriveList'
import { HINTS, showHint, type Hint } from '../lib/hint'
import { canListen, canSpeak, listen, nextRate, rateName, speak, speechRate, stopSpeaking, type Listening } from '../lib/speech'

// The main screen: one big button. The manager says anything about the app; the assistant asks for
// what is missing, answers questions, or repeats the requested change and asks "לאשר, או שיש עוד
// תיקון?". Only a yes (said, or the button) saves anything. Replies are spoken; the text is one tap away.

type Phase = 'idle' | 'listening' | 'thinking' | 'saving'

// The assistant's answer to a hard problem: up to 5 ranked solutions.
interface Advice {
  spoken: string
  options: { title: string; actions: string[]; why: string; cost: string; kind?: OptionKind; changes?: Edits }[]
  problem?: Problem['kind'] // set when the app's planner computed the options (solve)
}

interface Line {
  who: 'me' | 'app'
  text: string
}

// A proposal with wrong ids or dates goes back to the assistant at most this many times in a row.
const MAX_FIXES = 2

export function Voice({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const lists = {
    roles: useDriveList('roles'),
    certifications: useDriveList('certifications'),
    workers: useDriveList('workers'),
    shiftDefinitions: useDriveList('shiftDefinitions'),
    shifts: useDriveList('shifts'),
    pendingJobs: useDriveList('pendingJobs'),
    places: useDriveList('places'),
    jobTypes: useDriveList('jobTypes'),
    workKinds: useDriveList('workKinds'),
    postponeReasons: useDriveList('postponeReasons'),
    assistantNotes: useDriveList('assistantNotes'),
    departments: useDriveList('departments'),
    assistantExamples: useDriveList('assistantExamples'),
  }
  const loading = Object.values(lists).some((l) => l.query.isPending)
  const data = Object.fromEntries(Object.entries(lists).map(([k, l]) => [k, l.items])) as unknown as AppData

  const [phase, setPhase] = useState<Phase>('idle')
  const [heard, setHeard] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [showText, setShowText] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [typing, setTyping] = useState(!canListen)
  const [typed, setTyped] = useState('')
  const [rate, setRate] = useState(speechRate)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [advice, setAdvice] = useState<Advice | null>(null)
  const [talking, setTalking] = useState(false) // a conversation is open: it can be closed without saving
  const typedRef = useRef<HTMLInputElement>(null)
  const conversation = useRef<Turn[]>([])
  const solved = useRef<{ problem: Problem['kind']; options: SolverOption[] } | null>(null) // the planner's last options
  const asked = useRef<string[]>([]) // what the manager said in this conversation, for the example kept on a yes
  const last = useRef<AssistantAnswer | null>(null)
  const listening = useRef<Listening | null>(null)

  useEffect(() => () => {
    listening.current?.stop()
    stopSpeaking()
  }, [])

  const say = (text: string) => {
    setLines((l) => [...l, { who: 'app', text }])
    speak(text)
  }

  const reset = () => {
    conversation.current = []
    last.current = null
    asked.current = []
    setProposal(null)
    setAdvice(null)
    setTalking(false)
  }

  // One turn: send, then act on the tool call. Wrong proposals go back for fixing, quietly.
  const send = async (turn: Turn, fixes = 0) => {
    setPhase('thinking')
    setError(null)
    conversation.current = [...conversation.current, turn]
    let answer: AssistantAnswer
    let early = ''
    try {
      answer = await askAssistant(conversation.current, snapshot(data, undefined, asked.current.join(' ')), (text) => {
        // Spoken while the rest of the answer is still being written.
        early = text
        say(text)
      })
    } catch (e) {
      conversation.current = conversation.current.slice(0, -1)
      setError((e as Error).message)
      setPhase('idle')
      return
    }
    conversation.current = [...conversation.current, { role: 'assistant', content: answer.content }]
    setTalking(true)
    last.current = answer
    const call = answer.call
    if (call?.name === 'propose') {
      const p = normalizeProposal(call.input)
      const problems = proposalErrors(p, data)
      if (problems.length && fixes < MAX_FIXES) return send(userTurn(answer, '', `ההצעה לא תקינה: ${problems.join('; ')}. תקן והצע שוב, או שאל את המנהל.`, true), fixes + 1)
      if (problems.length) {
        setProposal(null)
        say('לא הצלחתי להבין את הבקשה עד הסוף. נסה להגיד אותה שוב במילים אחרות.')
        reset()
      } else {
        offer(p)
      }
    } else if (call?.name === 'answer') {
      setProposal(null)
      const text = String(call.input.text ?? '')
      if (text && text !== early) say(text)
      // A button only a tap may press (WhatsApp, sharing): open its screen and make it blink.
      const hint = call.input.pressButton as Hint | ''
      const screen = hint && hint in HINTS ? HINTS[hint] : (call.input.openScreen as Screen | '')
      if (screen)
        setTimeout(() => {
          onNavigate(screen)
          if (hint && hint in HINTS) showHint(hint)
        }, text ? 1800 : 0)
    } else if (call?.name === 'solve') {
      // The planner computes the options here, in milliseconds; the model then ranks and words them.
      const i = call.input as { kind: Problem['kind']; shiftId: string; workerIds: string[]; date: string }
      const problem: Problem = i.kind === 'day' ? { kind: 'day', date: i.date } : i.kind === 'missing' ? { kind: 'missing', shiftId: i.shiftId, workerIds: i.workerIds ?? [] } : { kind: 'job', shiftId: i.shiftId }
      solved.current = { problem: problem.kind, options: solve(data, problem) }
      // Once per turn: a model asking again is told to solve it itself.
      return send(userTurn(answer, '', fixes > MAX_FIXES ? 'פתור את הבעיה עם advise.' : optionsText(solved.current.options)), fixes + 1)
    } else if (call?.name === 'rank') {
      setProposal(null)
      const r = call.input as { spoken: string; order: number[]; notes: string[] }
      const all = solved.current?.options ?? []
      const order = (r.order ?? []).filter((n, k, list) => n >= 1 && n <= all.length && list.indexOf(n) === k)
      const shown = (order.length ? order : all.map((_, k) => k + 1)).map((n, k) => {
        const o = all[n - 1]
        const note = r.notes?.[k]?.trim()
        return { ...o, cost: note ? `${o.cost}. ${note}` : o.cost }
      })
      setAdvice({ spoken: r.spoken, options: shown, problem: solved.current?.problem })
      if (r.spoken !== early) say(r.spoken)
    } else if (call?.name === 'advise') {
      setProposal(null)
      const a = call.input as unknown as Advice
      setAdvice(a)
      if (a.spoken !== early) say(a.spoken)
    } else if (call?.name === 'ask_user') {
      setProposal(null)
      if (String(call.input.question ?? '') !== early) say(String(call.input.question ?? ''))
    } else {
      setProposal(null)
      say(answer.text || 'לא הבנתי. נסה שוב.')
    }
    setPhase('idle')
  }

  // A proposal is shown and said; a worker it moves out of another job at the same time is said
  // first and shown as a warning, so the yes is given knowing it (the user's rule).
  const offer = (p: Proposal) => {
    const moves = proposalConflicts(p, data)
    setConflicts(moves)
    setProposal(p)
    say(summaryWithConflicts(p.summary, moves))
  }

  const confirm = async (byButton: boolean) => {
    if (!proposal) return
    setPhase('saving')
    setError(null)
    const { data: next, changed, report } = applyProposal(proposal, data)
    // The confirmed request is kept as an example of how this manager works (newest last, capped).
    if (asked.current.length && proposal.summary) {
      next.assistantExamples = [
        ...data.assistantExamples,
        { id: newId(), said: asked.current.join(' / ').slice(0, 400), did: proposal.summary.slice(0, 500), createdAt: new Date().toISOString() },
      ].slice(-MAX_EXAMPLES)
      changed.add('assistantExamples')
    }
    try {
      // Lists first, then workers, then the jobs that may use them.
      for (const key of ['roles', 'certifications', 'places', 'jobTypes', 'postponeReasons', 'workers', 'shifts', 'pendingJobs', 'assistantNotes', 'assistantExamples'] as const) {
        if (changed.has(key)) await (lists[key].save as (items: unknown[]) => Promise<void>)(next[key])
      }
    } catch {
      setError('השמירה בגוגל דרייב נכשלה. כלום לא אבד, אפשר לנסות שוב.')
      setPhase('idle')
      return
    }
    if (byButton) setLines((l) => [...l, { who: 'me', text: 'מאשר' }])
    say(`${report.join('. ')}.`)
    reset()
    setPhase('idle')
  }

  const cancel = () => {
    stopSpeaking()
    setLines((l) => [...l, { who: 'me', text: 'ביטול' }])
    say('ביטלתי. לא נשמר כלום.')
    reset()
  }

  const handleSaid = (said: string) => {
    const text = said.trim()
    if (!text) return
    setLines((l) => [...l, { who: 'me', text }])
    if (proposal && isYes(text)) {
      void confirm(false)
      return
    }
    asked.current = [...asked.current, text]
    void send(userTurn(last.current, text, proposal ? 'המנהל לא אישר עדיין. התיקון שלו בהודעה הבאה.' : undefined))
  }

  // A picked solution goes back to the assistant, which turns it into a proposal to confirm.
  const pickOption = (i: number) => {
    if (!advice) return
    const o = advice.options[i]
    setAdvice(null)
    if (o.changes && advice.problem) {
      // The planner's option carries its own changes: a proposal at once, no model call. Picking
      // another kind than the recommended one is a preference worth remembering.
      const lesson = o.kind && advice.options[0].kind ? preferenceLesson(advice.problem, o.kind, advice.options[0].kind) : null
      const p: Proposal = {
        ...normalizeProposal({}),
        ...o.changes,
        summary: `${o.title}. ${o.actions.join('. ')}. לאשר, או שיש עוד תיקון?`,
        lessons: lesson ? [lesson] : [],
      }
      // The data may have changed since the options were computed: then the assistant redoes it.
      if (!proposalErrors(p, data).length) {
        setLines((l) => [...l, { who: 'me', text: `פתרון ${i + 1}` }])
        asked.current = [...asked.current, `פתרון ${i + 1}: ${o.title}`]
        offer(p)
        return
      }
    }
    handleSaid(`תעשה את פתרון ${i + 1}: ${o.title}`)
  }

  const toggleMic = () => {
    stopSpeaking()
    if (listening.current) {
      listening.current.stop()
      return
    }
    setError(null)
    setHeard('')
    const l = listen(setHeard, (text, err) => {
      listening.current = null
      setHeard('')
      setPhase('idle')
      if (err) setError(err)
      handleSaid(text)
    })
    if (!l) {
      setTyping(true)
      return
    }
    listening.current = l
    setPhase('listening')
  }

  // "תקן": the manager says (or types) the correction; it goes to the assistant as the next turn.
  const correct = () => {
    stopSpeaking()
    if (typing || !canListen) {
      setTyping(true)
      setTimeout(() => typedRef.current?.focus(), 0)
      return
    }
    toggleMic()
  }

  const busy = phase === 'thinking' || phase === 'saving' || loading
  const status =
    phase === 'listening' ? 'מקשיב... אפשר לדבר' : phase === 'thinking' ? 'חושב...' : phase === 'saving' ? 'שומר...' : loading ? 'טוען נתונים...' : proposal ? 'לאשר, או לתקן?' : advice ? 'איזה פתרון לעשות?' : talking ? 'לחץ וענה' : 'לחץ ודבר'

  return (
    <section className="flex min-h-[calc(100dvh-6rem)] flex-col items-center px-4 pt-10">
      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        <button
          type="button"
          onClick={toggleMic}
          disabled={busy}
          aria-pressed={phase === 'listening'}
          aria-label={phase === 'listening' ? 'עצירת ההקשבה' : 'דבר עם Shaly'}
          className={`flex size-44 items-center justify-center rounded-full border-4 shadow-xl transition active:scale-95 disabled:opacity-50 ${
            phase === 'listening' ? 'animate-pulse border-red-400 bg-red-500/20 text-red-100' : 'border-sky-400 bg-sky-500/15 text-sky-100'
          }`}
        >
          {busy && phase !== 'idle' ? (
            <Loader2 className="animate-spin" size={64} aria-hidden />
          ) : phase === 'listening' ? (
            <Square size={56} aria-hidden />
          ) : (
            <Mic size={72} aria-hidden />
          )}
        </button>
        <p className="text-lg text-slate-300" role="status">
          {status}
        </p>
        {heard && <p className="max-w-sm text-center text-slate-100">{heard}</p>}
        {error && (
          <p role="alert" className="max-w-sm text-center text-amber-300">
            {error}
          </p>
        )}

        {/* A proposal is always answered by "אשר" or "תקן"; a correction continues the conversation
            and comes back as a new proposal. Cancel is only a small link under them (user rule). */}
        {proposal && phase === 'idle' && conflicts.length > 0 && (
          <div role="alert" className="flex max-w-sm gap-2 rounded-2xl border border-amber-500/60 bg-amber-500/10 p-3 text-sm text-amber-100">
            <AlertTriangle size={20} aria-hidden className="mt-0.5 shrink-0 text-amber-300" />
            <ul className="space-y-1">
              {conflicts.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        {proposal && phase === 'idle' && (
          <div className="flex gap-3">
            <button type="button" onClick={() => void confirm(true)} className="flex min-h-12 items-center gap-2 rounded-xl bg-emerald-600 px-6 font-semibold text-white">
              <Check size={20} aria-hidden />
              אשר
            </button>
            <button type="button" onClick={correct} className="flex min-h-12 items-center gap-2 rounded-xl bg-sky-600 px-6 font-semibold text-white">
              <Pencil size={20} aria-hidden />
              תקן
            </button>
          </div>
        )}
        {advice && phase === 'idle' && (
          <ol className="w-full max-w-md space-y-3" aria-label="פתרונות">
            {advice.options.map((o, i) => (
              <li key={i} className="rounded-2xl border border-slate-700 bg-slate-800/60 p-4 text-sm text-slate-100">
                <p className="font-semibold">{`${i + 1}. ${o.title}`}</p>
                <ul className="mt-2 list-disc space-y-1 ps-5 text-slate-200">
                  {o.actions.map((a, k) => (
                    <li key={k}>{a}</li>
                  ))}
                </ul>
                <p className="mt-2 text-emerald-300">{o.why}</p>
                <p className="mt-1 text-amber-300">{o.cost}</p>
                <button type="button" onClick={() => pickOption(i)} className="mt-3 min-h-11 w-full rounded-xl bg-sky-600 font-semibold text-white">
                  {`תעשה את פתרון ${i + 1}`}
                </button>
              </li>
            ))}
          </ol>
        )}
        {talking && phase === 'idle' && (
          <button type="button" onClick={cancel} className="min-h-11 px-3 text-sm text-slate-400 underline underline-offset-4">
            {proposal ? 'ביטול, לסגור בלי לשמור' : 'לסגור את השיחה'}
          </button>
        )}
      </div>

      <div className="w-full max-w-md space-y-3 pb-4">
        {typing && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSaid(typed)
              setTyped('')
            }}
            className="flex gap-2"
          >
            <input ref={typedRef} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="אפשר גם להקליד" className={inputClass} disabled={busy} />
            <button type="submit" disabled={busy || !typed.trim()} className="min-h-11 rounded-xl bg-sky-600 px-4 font-semibold text-white disabled:opacity-50">
              שלח
            </button>
          </form>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          {lines.length > 0 && (
            <button type="button" onClick={() => setShowText((s) => !s)} aria-expanded={showText} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200">
              <MessageSquareText size={18} aria-hidden />
              {showText ? 'הסתר טקסט' : 'הצג טקסט'}
            </button>
          )}
          {canSpeak && (
            <button
              type="button"
              onClick={() => {
                const v = nextRate()
                setRate(v)
                speak(`ככה אני מדבר בקצב ${rateName(v)}`)
              }}
              aria-label={`מהירות הדיבור: ${rateName(rate)}. לחיצה משנה`}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200"
            >
              <Gauge size={18} aria-hidden />
              {`קצב: ${rateName(rate)}`}
            </button>
          )}
          {canListen && (
            <button type="button" onClick={() => setTyping((t) => !t)} aria-pressed={typing} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200">
              <Keyboard size={18} aria-hidden />
              הקלדה
            </button>
          )}
          {data.assistantNotes.length > 0 && (
            <button type="button" onClick={() => setShowNotes((s) => !s)} aria-expanded={showNotes} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200">
              <BookMarked size={18} aria-hidden />
              {`מה אני זוכר (${data.assistantNotes.length})`}
            </button>
          )}
        </div>
        {showNotes && data.assistantNotes.length > 0 && (
          <ul className="space-y-2" aria-label="מה העוזר זוכר">
            {data.assistantNotes.map((n) => (
              <li key={n.id} className="flex items-center gap-2 rounded-2xl bg-slate-800 px-4 py-2 text-sm text-slate-100">
                <span className="flex-1">
                  {n.text}
                  {n.learned && <span className="ms-2 rounded-full bg-violet-500/20 px-2 text-xs text-violet-200">למדתי</span>}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void lists.assistantNotes.save(data.assistantNotes.filter((x) => x.id !== n.id)).catch(() => setError('המחיקה בגוגל דרייב נכשלה. נסה שוב.'))}
                  aria-label={`למחוק: ${n.text}`}
                  className="flex size-11 items-center justify-center rounded-xl text-slate-400 hover:text-red-300 disabled:opacity-50"
                >
                  <Trash2 size={18} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {showText && (
          <ol className="space-y-2">
            {lines.map((line, i) => (
              <li
                key={i}
                className={`rounded-2xl px-4 py-2 text-sm ${line.who === 'me' ? 'ms-8 bg-sky-900/50 text-sky-50' : 'me-8 bg-slate-800 text-slate-100'}`}
              >
                {line.text}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
