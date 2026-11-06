import { useEffect, useRef, useState } from 'react'
import { Check, Keyboard, Loader2, Mic, MessageSquareText, Square, X } from 'lucide-react'
import { inputClass } from '../components/Sheet'
import { applyProposal, isYes, proposalErrors, snapshot, type AppData, type Proposal, type Screen } from '../lib/assistant'
import { askAssistant, userTurn, type AssistantAnswer, type Turn } from '../lib/assistantApi'
import { useDriveList } from '../lib/data/useDriveList'
import { canListen, listen, speak, stopSpeaking, type Listening } from '../lib/speech'

// The main screen: one big button. The manager says anything about the app; the assistant asks for
// what is missing, answers questions, or repeats the requested change and asks "לאשר, או שיש עוד
// תיקון?". Only a yes (said, or the button) saves anything. Replies are spoken; the text is one tap away.

type Phase = 'idle' | 'listening' | 'thinking' | 'saving'

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
  }
  const loading = Object.values(lists).some((l) => l.query.isPending)
  const data = Object.fromEntries(Object.entries(lists).map(([k, l]) => [k, l.items])) as unknown as AppData

  const [phase, setPhase] = useState<Phase>('idle')
  const [heard, setHeard] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [showText, setShowText] = useState(false)
  const [typing, setTyping] = useState(!canListen)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const conversation = useRef<Turn[]>([])
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
    setProposal(null)
  }

  // One turn: send, then act on the tool call. Wrong proposals go back for fixing, quietly.
  const send = async (turn: Turn, fixes = 0) => {
    setPhase('thinking')
    setError(null)
    conversation.current = [...conversation.current, turn]
    let answer: AssistantAnswer
    try {
      answer = await askAssistant(conversation.current, snapshot(data))
    } catch (e) {
      conversation.current = conversation.current.slice(0, -1)
      setError((e as Error).message)
      setPhase('idle')
      return
    }
    conversation.current = [...conversation.current, { role: 'assistant', content: answer.content }]
    last.current = answer
    const call = answer.call
    if (call?.name === 'propose') {
      const p = call.input as unknown as Proposal
      const problems = proposalErrors(p, data)
      if (problems.length && fixes < MAX_FIXES) return send(userTurn(answer, '', `ההצעה לא תקינה: ${problems.join('; ')}. תקן והצע שוב, או שאל את המנהל.`, true), fixes + 1)
      if (problems.length) {
        setProposal(null)
        say('לא הצלחתי להבין את הבקשה עד הסוף. נסה להגיד אותה שוב במילים אחרות.')
        reset()
      } else {
        setProposal(p)
        say(p.summary)
      }
    } else if (call?.name === 'answer') {
      setProposal(null)
      const text = String(call.input.text ?? '')
      if (text) say(text)
      const screen = call.input.openScreen as Screen | ''
      if (screen) setTimeout(() => onNavigate(screen), text ? 1800 : 0)
    } else if (call?.name === 'ask_user') {
      setProposal(null)
      say(String(call.input.question ?? ''))
    } else {
      setProposal(null)
      say(answer.text || 'לא הבנתי. נסה שוב.')
    }
    setPhase('idle')
  }

  const confirm = async (byButton: boolean) => {
    if (!proposal) return
    setPhase('saving')
    setError(null)
    const { data: next, changed, report } = applyProposal(proposal, data)
    try {
      // Lists first, then workers, then the jobs that may use them.
      for (const key of ['roles', 'certifications', 'places', 'jobTypes', 'postponeReasons', 'workers', 'shifts', 'pendingJobs'] as const) {
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
    void send(userTurn(last.current, text, proposal ? 'המנהל לא אישר עדיין. התיקון שלו בהודעה הבאה.' : undefined))
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

  const busy = phase === 'thinking' || phase === 'saving' || loading
  const status =
    phase === 'listening' ? 'מקשיב... אפשר לדבר' : phase === 'thinking' ? 'חושב...' : phase === 'saving' ? 'שומר...' : loading ? 'טוען נתונים...' : proposal ? 'לאשר, לתקן בקול, או לבטל' : 'לחץ ודבר'

  return (
    <section className="flex min-h-[calc(100dvh-6rem)] flex-col items-center px-4 pt-10">
      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        <button
          type="button"
          onClick={toggleMic}
          disabled={busy}
          aria-pressed={phase === 'listening'}
          aria-label={phase === 'listening' ? 'עצירת ההקשבה' : 'דבר עם העוזר'}
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

        {proposal && phase === 'idle' && (
          <div className="flex gap-3">
            <button type="button" onClick={() => void confirm(true)} className="flex min-h-12 items-center gap-2 rounded-xl bg-emerald-600 px-6 font-semibold text-white">
              <Check size={20} aria-hidden />
              אשר
            </button>
            <button type="button" onClick={cancel} className="flex min-h-12 items-center gap-2 rounded-xl border border-slate-600 px-5 text-slate-200">
              <X size={20} aria-hidden />
              ביטול
            </button>
          </div>
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
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="אפשר גם להקליד" className={inputClass} disabled={busy} />
            <button type="submit" disabled={busy || !typed.trim()} className="min-h-11 rounded-xl bg-sky-600 px-4 font-semibold text-white disabled:opacity-50">
              שלח
            </button>
          </form>
        )}
        <div className="flex justify-center gap-2">
          {lines.length > 0 && (
            <button type="button" onClick={() => setShowText((s) => !s)} aria-expanded={showText} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200">
              <MessageSquareText size={18} aria-hidden />
              {showText ? 'הסתר טקסט' : 'הצג טקסט'}
            </button>
          )}
          {canListen && (
            <button type="button" onClick={() => setTyping((t) => !t)} aria-pressed={typing} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200">
              <Keyboard size={18} aria-hidden />
              הקלדה
            </button>
          )}
        </div>
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
