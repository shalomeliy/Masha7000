import { language, tx } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, AudioLines, BookMarked, Check, Gauge, Keyboard, Loader2, Mic, MessageSquareText, Pencil, Square, Trash2 } from 'lucide-react'
import { inputClass } from '../components/Sheet'
import { applyProposal, isYes, MAX_EXAMPLES, normalizeProposal, proposalConflicts, proposalErrors, snapshot, summaryWithConflicts, type AppData, type Proposal, type Screen } from '../lib/assistant'
import { newId } from '../lib/catalog'
import type { Edits } from '../lib/assistantEdits'
import { optionsText, preferenceLesson, solve, type OptionKind, type Problem, type SolverOption } from '../lib/solvers'
import { askAssistant, fetchBudget, userTurn, type AssistantAnswer, type Budget, type Turn } from '../lib/assistantApi'
import { realAssistantOn, setRealAssistant } from '../dev/realAssistant'
import { claudePart, continueJob, continueWho, countTurn, exampleAction, handleFree, knownResult, learn, mergeProposals, pickedOption, sickPlan, splitFree, usage, whyNotFree, type Local, type PendingJob, type PendingWho } from '../lib/freeCommands'
import { saveEntry, type ClaudeLogEntry, type LogOutcome } from '../lib/claudeLog'
import { useDriveList } from '../lib/data/useDriveList'
import { HINTS, showHint, type Hint } from '../lib/hint'
import { canListen, canSpeak, currentVoice, listen, nextRate, nextVoice, onVoicesChanged, rateName, speak, speechRate, stopSpeaking, voiceName, voices, type Listening } from '../lib/speech'

// The main screen: one big button. The manager says anything about the app; the assistant asks for
// what is missing, answers questions, or repeats the requested change and asks "לאשר, או שיש עוד
// תיקון?". Only a yes (said, or the button) saves anything. Replies are spoken; the text is one tap away.

type Phase = 'idle' | 'listening' | 'thinking' | 'saving'

// The assistant's answer to a hard problem: up to 5 ranked solutions.
interface Advice {
  spoken: string
  options: { title: string; actions: string[]; why: string; cost: string; kind?: OptionKind; changes?: Edits; proposal?: Proposal }[]
  problem?: Problem['kind'] // set when the app's planner computed the options (solve)
  extra?: Edits // made here without Claude (freeCommands): changes that go with any picked option (the worker marked sick)
  extraText?: string // and how they are said
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
  // The phone's voices for the app's language; they may load a moment after the screen opens.
  const [voiceList, setVoiceList] = useState(voices)
  const [voice, setVoice] = useState(currentVoice)
  useEffect(() => onVoicesChanged(() => {
    setVoiceList(voices())
    setVoice(currentVoice())
  }), [])
  const [realDev, setRealDev] = useState(realAssistantOn)
  const [used, setUsed] = useState(usage)
  const [budget, setBudget] = useState<Budget | null>(null)
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
  const pendingJob = useRef<PendingJob | null>(null) // a job being opened here, free, waiting for a missing detail
  const pendingWho = useRef<PendingWho | null>(null) // a name close to two workers, waiting for "which one"
  const fromFree = useRef(false) // the open proposal was made here, not by Claude: nothing to learn from it
  // A long sentence whose known parts are done here: they join whatever Claude proposes for the rest.
  const localPart = useRef<{ texts: string[]; proposal: Proposal | null } | null>(null)
  const claudeProposal = useRef<Proposal | null>(null) // Claude's own part of a joined proposal: what is learned on a yes
  const listening = useRef<Listening | null>(null)
  // This conversation's line in the "what went to Claude" log (src/lib/claudeLog.ts), once it reached Claude.
  const logged = useRef<ClaudeLogEntry | null>(null)

  const logStart = (reason: string, understood = '') => {
    logged.current = { id: newId(), at: new Date().toISOString(), lang: language().code, said: [...asked.current], reason, understood, did: [], outcome: 'pending', learned: '' }
  }
  const logUpdate = (change: (e: ClaudeLogEntry) => ClaudeLogEntry) => {
    if (!logged.current) return
    logged.current = change(logged.current)
    saveEntry(logged.current)
  }
  const logEnd = (outcome: LogOutcome, learned = '') => logUpdate((e) => ({ ...e, outcome, learned }))
  const logDid = (line: string, outcome?: LogOutcome) => logUpdate((e) => ({ ...e, did: [...e.did, line], outcome: outcome ?? e.outcome }))

  // How much of the month's Anthropic budget is left (counted on the server, api/_lib/budget.ts).
  useEffect(() => {
    let live = true
    fetchBudget().then((b) => live && b && setBudget(b))
    return () => {
      live = false
    }
  }, [])

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
    pendingJob.current = null
    pendingWho.current = null
    fromFree.current = false
    localPart.current = null
    claudeProposal.current = null
    logged.current = null
    setProposal(null)
    setAdvice(null)
    setTalking(false)
  }

  // One turn: send, then act on the tool call. Wrong proposals go back for fixing, quietly.
  const send = async (turn: Turn, fixes = 0) => {
    setPhase('thinking')
    setError(null)
    fromFree.current = false
    conversation.current = [...conversation.current, turn]
    let answer: AssistantAnswer
    let early = ''
    try {
      answer = await askAssistant(conversation.current, snapshot(data, undefined, asked.current.join(' ')), (text) => {
        // Spoken while the rest of the answer is still being written.
        early = text
        say(text)
      }, setBudget)
    } catch (e) {
      conversation.current = conversation.current.slice(0, -1)
      logDid(`error: ${(e as Error).message}`)
      setError((e as Error).message)
      setPhase('idle')
      offerLocalPart() // the parts the app knows are not lost
      return
    }
    // Counted only when Claude answered: a refused call (no credit, no connection) is not charged.
    setUsed(countTurn('paid'))
    conversation.current = [...conversation.current, { role: 'assistant', content: answer.content }]
    setTalking(true)
    last.current = answer
    const call = answer.call
    if (call?.name === 'propose') {
      const p = normalizeProposal(call.input)
      const problems = proposalErrors(p, data)
      logDid(`propose: ${p.summary}${problems.length ? ` (invalid: ${problems.join('; ')})` : ''}`)
      if (problems.length && fixes < MAX_FIXES) return send(userTurn(answer, '', tx('ההצעה לא תקינה: {v}. תקן והצע שוב, או שאל את המנהל.', { v: problems.join('; ') }), true), fixes + 1)
      if (problems.length) {
        logEnd('failed')
        setProposal(null)
        const sorry = tx('לא הצלחתי להבין את הבקשה עד הסוף. נסה להגיד אותה שוב במילים אחרות.')
        if (!offerLocalPart(sorry)) {
          say(sorry)
          reset()
        }
      } else {
        offer(p)
      }
    } else if (call?.name === 'answer') {
      setProposal(null)
      const text = String(call.input.text ?? '')
      logDid(`answer: ${text}${call.input.openScreen ? ` [opens ${String(call.input.openScreen)}]` : ''}`, 'answered')
      // The parts the app did itself still wait for a yes: no screen is opened over them.
      if (offerLocalPart(text && text !== early ? text : '')) {
        setPhase('idle')
        return
      }
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
      logDid(`solve: ${problem.kind}, ${solved.current.options.length} options`)
      // Once per turn: a model asking again is told to solve it itself.
      return send(userTurn(answer, '', fixes > MAX_FIXES ? tx('פתור את הבעיה עם advise.') : optionsText(solved.current.options)), fixes + 1)
    } else if (call?.name === 'rank') {
      setProposal(null)
      const r = call.input as { spoken: string; order: number[]; notes: string[] }
      logDid(`rank: ${r.spoken}`)
      const all = solved.current?.options ?? []
      const order = (r.order ?? []).filter((n, k, list) => n >= 1 && n <= all.length && list.indexOf(n) === k)
      const shown = (order.length ? order : all.map((_, k) => k + 1)).map((n, k) => {
        const o = all[n - 1]
        const note = r.notes?.[k]?.trim()
        return { ...o, cost: note ? `${o.cost}. ${note}` : o.cost }
      })
      // "<worker> חולה ...": the sickness itself goes with whichever replacement is picked (a pick is free, no Claude).
      const sick = solved.current?.problem === 'missing' && asked.current[0] ? sickPlan(asked.current[0], data, learn(data.assistantExamples, data), new Date()) : null
      setAdvice({ spoken: r.spoken, options: shown, problem: solved.current?.problem, ...(sick ? { extra: sick.extra, extraText: sick.sickText } : {}) })
      if (r.spoken !== early) say(r.spoken)
    } else if (call?.name === 'advise') {
      setProposal(null)
      const a = call.input as unknown as Advice
      logDid(`advise: ${a.spoken}`)
      setAdvice(a)
      if (a.spoken !== early) say(a.spoken)
    } else if (call?.name === 'ask_user') {
      setProposal(null)
      logDid(`ask: ${String(call.input.question ?? '')}`)
      if (String(call.input.question ?? '') !== early) say(String(call.input.question ?? ''))
    } else {
      setProposal(null)
      logDid(`text: ${answer.text}`)
      say(answer.text || tx('לא הבנתי. נסה שוב.'))
    }
    setPhase('idle')
  }

  // A proposal is shown and said; a worker it moves out of another job at the same time is said
  // first and shown as a warning, so the yes is given knowing it (the user's rule).
  const offer = (p: Proposal, before = '') => {
    // Claude's proposal for the rest of a long sentence: the parts done here join it, one read-back.
    if (localPart.current?.proposal && !fromFree.current) {
      claudeProposal.current = p
      p = mergeProposals([localPart.current.proposal, p])
    }
    const moves = proposalConflicts(p, data)
    setConflicts(moves)
    setProposal(p)
    say(`${before ? `${before} ` : ''}${summaryWithConflicts(p.summary, moves)}`)
  }

  // When Claude ends without a proposal (an answer, an error), the parts done here are offered alone.
  const offerLocalPart = (before = ''): boolean => {
    const p = localPart.current?.proposal
    localPart.current = null
    if (!p) return false
    fromFree.current = true
    setTalking(true)
    offer(p, before)
    return true
  }

  const confirm = async (byButton: boolean) => {
    if (!proposal) return
    setPhase('saving')
    setError(null)
    const { data: next, changed, report } = applyProposal(proposal, data)
    // From a joined proposal only Claude's part is learned, with what was said for it.
    const own = claudeProposal.current ?? proposal
    const action = fromFree.current ? undefined : exampleAction(own, asked.current)
    // The confirmed request is kept as an example of how this manager works (newest last, capped).
    if (asked.current.length && proposal.summary) {
      next.assistantExamples = [
        ...data.assistantExamples,
        {
          id: newId(),
          said: asked.current.join(' / ').slice(0, 400),
          did: own.summary.slice(0, 500),
          createdAt: new Date().toISOString(),
          // What Claude did, so the next request said this way is done here, free (freeCommands).
          ...(fromFree.current ? {} : { action }),
        },
      ].slice(-MAX_EXAMPLES)
      changed.add('assistantExamples')
    }
    try {
      // Lists first, then workers, then the jobs that may use them.
      for (const key of ['roles', 'certifications', 'places', 'jobTypes', 'postponeReasons', 'workers', 'shifts', 'pendingJobs', 'assistantNotes', 'assistantExamples'] as const) {
        if (changed.has(key)) await (lists[key].save as (items: unknown[]) => Promise<void>)(next[key])
      }
    } catch {
      setError(tx('השמירה בגוגל דרייב נכשלה. כלום לא אבד, אפשר לנסות שוב.'))
      setPhase('idle')
      return
    }
    if (byButton) setLines((l) => [...l, { who: 'me', text: tx('מאשר') }])
    logEnd('confirmed', action?.type ?? '')
    say(`${report.join('. ')}.`)
    reset()
    setPhase('idle')
  }

  const cancel = () => {
    stopSpeaking()
    setLines((l) => [...l, { who: 'me', text: tx('ביטול') }])
    logEnd('cancelled')
    say(tx('ביטלתי. לא נשמר כלום.'))
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
    // Picking a solution by voice ("כן", "הראשון", "פתרון 2") is done here, free.
    const picked = advice ? pickedOption(text, advice.options.length) : null
    if (picked !== null) {
      pickOption(picked)
      return
    }
    asked.current = [...asked.current, text]
    // Before Claude: what the app can do by itself, free (Hebrew only, and only while Claude is not
    // in the conversation). Anything it does not fully understand goes to Claude with all that was said.
    if (conversation.current.length === 0 && language().code === 'he') {
      const now = new Date()
      const learned = learn(data.assistantExamples, data)
      // The answer to "למי התכוונת": the first sentence again, with the worker picked, as if said that way.
      const waitingWho = pendingWho.current
      const waitingJob = pendingJob.current
      const who = waitingWho ? continueWho(text, waitingWho, data, learned, now) : null
      if (who) asked.current = [who.text]
      const local = who ? who.local : waitingWho ? null : waitingJob ? continueJob(text, waitingJob, data, learned, now) : asked.current.length === 1 ? handleFree(text, data, learned, now) : null
      pendingWho.current = null
      if (actFree(local)) return
      // One long sentence with several requests: the known ones here, free; only the rest to Claude.
      if (!local && !waitingWho && !waitingJob && asked.current.length === 1 && actSplit(text, learned, now)) return
      // Why it was not done free, for the log (the developer teaches the next action from it).
      const why = whyNotFree(asked.current[0], data, learned, now)
      if (local?.kind === 'propose') logStart(`a free proposal failed the checks: ${proposalErrors(local.proposal, data).join('; ')}`, why.understood)
      else if (waitingWho) logStart('the answer to "which worker did you mean" was not understood', why.understood)
      else if (waitingJob) logStart(`the answer to the free question about the job's ${waitingJob.missing[0]} was not understood`, why.understood)
      else if (asked.current.length > 1) logStart('a later sentence of a conversation that started free', why.understood)
      else logStart(why.reason, why.understood)
      pendingJob.current = null
      setProposal(null)
      setAdvice(null)
      void send({ role: 'user', content: asked.current.join('. ') })
      return
    }
    if (!logged.current) logStart(language().code === 'he' ? 'Claude was already in the conversation' : `not Hebrew (${language().code}): the free path runs only in Hebrew`)
    else logUpdate((e) => ({ ...e, said: [...e.said, text] }))
    const notes = [proposal ? tx('המנהל לא אישר עדיין. התיקון שלו בהודעה הבאה.') : '']
    // A correction of a joined proposal: Claude now does all of it, so nothing done here is lost or done twice.
    if (localPart.current && proposal) {
      notes.push(`באותו משפט המנהל ביקש גם: ${localPart.current.texts.map((t) => `"${t}"`).join(', ')}. כלול גם אותם בהצעה החדשה.`)
      asked.current = [...localPart.current.texts, ...asked.current]
      localPart.current = null
      claudeProposal.current = null
    }
    void send(userTurn(last.current, text, notes.filter(Boolean).join(' ') || undefined))
  }

  // A long sentence: the parts the app knows are done here; the rest alone goes to Claude, and is logged.
  const actSplit = (text: string, learned: ReturnType<typeof learn>, now: Date): boolean => {
    const split = splitFree(text, data, learned, now)
    if (!split) return false
    const { says, proposal: mine } = knownResult(split)
    if (mine && proposalErrors(mine, data).length) return false
    const said = says.join(' ')
    if (!split.unknown.length) {
      setUsed(countTurn('free'))
      setError(null)
      if (!mine) {
        say(said)
        reset()
        return true
      }
      fromFree.current = true
      setTalking(true)
      offer(mine, said)
      return true
    }
    if (said) say(said)
    localPart.current = { texts: split.known.map((k) => k.text), proposal: mine }
    asked.current = [split.unknown.join('. ')]
    const why = whyNotFree(split.unknown[0], data, learned, now)
    logStart(`part of a long sentence; done free: ${split.known.map((k) => `"${k.text}"`).join(', ')}. This part: ${why.reason}`, why.understood)
    setProposal(null)
    setAdvice(null)
    void send({ role: 'user', content: claudePart(split, text) })
    return true
  }

  // Does what freeCommands found; false when it is nothing (or not valid), for Claude.
  const actFree = (local: Local): boolean => {
    if (!local) return false
    if (local.kind === 'propose' && proposalErrors(local.proposal, data).length) return false
    setUsed(countTurn('free'))
    setError(null)
    if (local.kind === 'open') {
      say(local.text)
      reset()
      setTimeout(() => {
        onNavigate(local.screen)
        if (local.hint) showHint(local.hint)
      }, 1500)
    } else if (local.kind === 'say') {
      say(local.text)
      reset()
    } else if (local.kind === 'which') {
      pendingWho.current = local.pending
      setTalking(true)
      say(local.question)
    } else if (local.kind === 'ask') {
      pendingJob.current = local.pending
      setTalking(true)
      say(local.question)
    } else if (local.kind === 'propose') {
      pendingJob.current = null
      fromFree.current = true
      setTalking(true)
      offer(local.proposal)
    } else {
      pendingJob.current = null
      fromFree.current = true
      setTalking(true)
      setProposal(null)
      setAdvice({ spoken: local.spoken, options: local.options, problem: local.options.some((o) => o.proposal) ? undefined : 'missing', extra: local.extra, extraText: local.extraText })
      say(local.spoken)
    }
    return true
  }

  // A picked solution goes back to the assistant, which turns it into a proposal to confirm.
  const pickOption = (i: number) => {
    if (!advice) return
    const o = advice.options[i]
    setAdvice(null)
    // A ready new job (the free days of workers who must be in it): offered as it is.
    if (o.proposal && !proposalErrors(o.proposal, data).length) {
      setLines((l) => [...l, { who: 'me', text: tx('פתרון {v}', { v: i + 1 }) }])
      asked.current = [...asked.current, tx('פתרון {v}: {title}', { v: i + 1, title: o.title })]
      offer(o.proposal)
      return
    }
    if (o.changes && advice.problem) {
      // The planner's option carries its own changes: a proposal at once, no model call. Picking
      // another kind than the recommended one is a preference worth remembering.
      const lesson = o.kind && advice.options[0].kind ? preferenceLesson(advice.problem, o.kind, advice.options[0].kind) : null
      const p: Proposal = {
        ...normalizeProposal({}),
        ...o.changes,
        editWorkers: [...o.changes.editWorkers, ...(advice.extra?.editWorkers ?? [])],
        addConstraints: [...o.changes.addConstraints, ...(advice.extra?.addConstraints ?? [])],
        summary: `${advice.extraText ? `${advice.extraText}. ` : ''}${tx('{title}. {v}. לאשר, או שיש עוד תיקון?', { title: o.title, v: o.actions.join('. ') })}`,
        lessons: lesson ? [lesson] : [],
      }
      // The data may have changed since the options were computed: then the assistant redoes it.
      if (!proposalErrors(p, data).length) {
        setLines((l) => [...l, { who: 'me', text: tx('פתרון {v}', { v: i + 1 }) }])
        asked.current = [...asked.current, tx('פתרון {v}: {title}', { v: i + 1, title: o.title })]
        offer(p)
        return
      }
    }
    handleSaid(tx('תעשה את פתרון {v}: {title}', { v: i + 1, title: o.title }))
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
    phase === 'listening' ? tx('מקשיב... אפשר לדבר') : phase === 'thinking' ? tx('חושב...') : phase === 'saving' ? tx('שומר...') : loading ? tx('טוען נתונים...') : proposal ? tx('לאשר, או לתקן?') : advice ? tx('איזה פתרון לעשות?') : talking ? tx('לחץ וענה') : tx('לחץ ודבר')

  return (
    <section className="flex min-h-[calc(100dvh-6rem)] flex-col items-center px-4 pt-10">
      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        <button
          type="button"
          onClick={toggleMic}
          disabled={busy}
          aria-pressed={phase === 'listening'}
          aria-label={phase === 'listening' ? tx('עצירת ההקשבה') : tx('דבר עם Shaly')}
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
        {(used.free > 0 || used.paid > 0) && (
          <p className="text-xs text-slate-400">{tx('החודש: {free} פקודות בחינם, {paid} דרך Claude (בתשלום)', { free: used.free, paid: used.paid })}</p>
        )}
        {budget && <BudgetLine budget={budget} />}
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
              {tx('אשר')}
            </button>
            <button type="button" onClick={correct} className="flex min-h-12 items-center gap-2 rounded-xl bg-sky-600 px-6 font-semibold text-white">
              <Pencil size={20} aria-hidden />
              {tx('תקן')}
            </button>
          </div>
        )}
        {advice && phase === 'idle' && (
          <ol className="w-full max-w-md space-y-3" aria-label={tx('פתרונות')}>
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
                  {tx('תעשה את פתרון {v}', { v: i + 1 })}
                </button>
              </li>
            ))}
          </ol>
        )}
        {talking && phase === 'idle' && (
          <button type="button" onClick={cancel} className="min-h-11 px-3 text-sm text-slate-400 underline underline-offset-4">
            {proposal ? tx('ביטול, לסגור בלי לשמור') : tx('לסגור את השיחה')}
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
            <input ref={typedRef} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={tx('אפשר גם להקליד')} className={inputClass} disabled={busy} />
            <button type="submit" disabled={busy || !typed.trim()} className="min-h-11 rounded-xl bg-sky-600 px-4 font-semibold text-white disabled:opacity-50">
              {tx('שלח')}
            </button>
          </form>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          {/* Dev server only (not in the build, not translated): the owner's switch between the free
              stand-in and the real, paid assistant (src/dev/realAssistant.ts). */}
          {import.meta.env.DEV && (
            <button
              type="button"
              onClick={() => {
                setRealAssistant(!realDev)
                setRealDev(!realDev)
              }}
              aria-pressed={realDev}
              className={`flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm ${realDev ? 'border-amber-500 text-amber-300' : 'border-slate-700 text-slate-200'}`}
            >
              {realDev ? 'בדיקה מקומית: עוזר אמיתי (עולה כסף)' : 'בדיקה מקומית: תשובת דמה (חינם)'}
            </button>
          )}
          {/* Dev server only: what was learned from Claude so far, to see why a request still went to Claude. */}
          {import.meta.env.DEV && (
            <p className="w-full text-center text-xs text-slate-500">
              {`נלמד מ-Claude: חולה ${data.assistantExamples.filter((e) => e.action?.type === 'sick').length}, עבודה חדשה ${data.assistantExamples.filter((e) => e.action?.type === 'job').length} (מתוך ${data.assistantExamples.length} בקשות שאושרו)`}
            </p>
          )}
          {lines.length > 0 && (
            <button type="button" onClick={() => setShowText((s) => !s)} aria-expanded={showText} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200">
              <MessageSquareText size={18} aria-hidden />
              {showText ? tx('הסתר טקסט') : tx('הצג טקסט')}
            </button>
          )}
          {canSpeak && (
            <button
              type="button"
              onClick={() => {
                const v = nextRate()
                setRate(v)
                speak(tx('ככה אני מדבר בקצב {v}', { v: rateName(v) }))
              }}
              aria-label={tx('מהירות הדיבור: {v}. לחיצה משנה', { v: rateName(rate) })}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200"
            >
              <Gauge size={18} aria-hidden />
              {tx('קצב: {v}', { v: rateName(rate) })}
            </button>
          )}
          {canSpeak && voiceList.length > 1 && (
            <button
              type="button"
              onClick={() => {
                const v = nextVoice()
                setVoice(v)
                speak(tx('ככה נשמע הקול הזה'))
              }}
              aria-label={tx('קול הדיבור: {v}. לחיצה מחליפה לקול אחר', { v: voiceName(voice) })}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200"
            >
              <AudioLines size={18} aria-hidden />
              {tx('קול: {v}', { v: voiceName(voice) })}
            </button>
          )}
          {canListen && (
            <button type="button" onClick={() => setTyping((t) => !t)} aria-pressed={typing} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200">
              <Keyboard size={18} aria-hidden />
              {tx('הקלדה')}
            </button>
          )}
          {data.assistantNotes.length > 0 && (
            <button type="button" onClick={() => setShowNotes((s) => !s)} aria-expanded={showNotes} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm text-slate-200">
              <BookMarked size={18} aria-hidden />
              {tx('מה אני זוכר ({length})', { length: data.assistantNotes.length })}
            </button>
          )}
        </div>
        {showNotes && data.assistantNotes.length > 0 && (
          <ul className="space-y-2" aria-label={tx('מה העוזר זוכר')}>
            {data.assistantNotes.map((n) => (
              <li key={n.id} className="flex items-center gap-2 rounded-2xl bg-slate-800 px-4 py-2 text-sm text-slate-100">
                <span className="flex-1">
                  {n.text}
                  {n.learned && <span className="ms-2 rounded-full bg-violet-500/20 px-2 text-xs text-violet-200">{tx('למדתי')}</span>}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void lists.assistantNotes.save(data.assistantNotes.filter((x) => x.id !== n.id)).catch(() => setError(tx('המחיקה בגוגל דרייב נכשלה. נסה שוב.')))}
                  aria-label={tx('למחוק: {text}', { text: n.text })}
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

/** "Left this month: $3.80 of $5", with a bar; amber when little is left, and a note on what it counts. */
function BudgetLine({ budget }: { budget: Budget }) {
  const left = Math.max(0, budget.limitUsd - budget.spentUsd)
  const share = budget.limitUsd > 0 ? left / budget.limitUsd : 0
  const low = share < 0.2
  const money = (n: number) => `$${n.toFixed(2)}`
  const firstOfMonth = `${new Date().toISOString().slice(0, 7)}-01`
  return (
    <div className="w-full max-w-xs text-center text-xs text-slate-400">
      <p className={low ? 'text-amber-300' : undefined}>
        {tx('נשאר מהתקציב החודש: {left} מתוך {limit}', { left: money(left), limit: money(budget.limitUsd) })}
      </p>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        aria-label={tx('נשאר מהתקציב')}
      >
        <div className={`h-full rounded-full ${low ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      {budget.since && budget.since > firstOfMonth && (
        <p className="mt-1">{tx('נספר מ-{date}. מה שנוצל לפני כן לא נכלל.', { date: budget.since.split('-').reverse().join('/') })}</p>
      )}
      {/* Dev server only, not translated: the number above is made up. */}
      {budget.mock && <p className="mt-1">בדיקה מקומית: מספר דמה</p>}
    </div>
  )
}
