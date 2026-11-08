import { useEffect, useMemo, useState } from 'react'
import { Check, PencilLine, SkipForward, Undo2, Volume2, X } from 'lucide-react'
import { DriveError } from '../../components/DriveError'
import { inputClass } from '../../components/Sheet'
import { newId } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import { BUILT_IN, pronunciationError, reviewQueue } from '../../lib/pronounce'
import { canSpeak, speak } from '../../lib/speech'
import { tx } from '../../i18n'

// "אימון הגייה": the manager hears the words Shaly says, one at a time, and says whether each sounds
// right. A word that sounds right stays as it is; a word he fixes is said his way from then on. The
// first round is the starting list (src/lib/pronunciationSeed.ts); after it, every word Shaly says that
// was not heard yet waits here (src/App.tsx, NewWords).

const ERRORS: Record<string, string> = {
  say: tx('כתוב איך לומר אותה. אפשר גם באותיות באנגלית.'),
  same: tx('כתוב את ההגייה אחרת מהמילה, אחרת שום דבר לא ישתנה.'),
}

export function PronunciationSection() {
  const fixed = useDriveList('pronunciations')
  const approved = useDriveList('approvedWords')
  const fresh = useDriveList('newWords')
  const [seed, setSeed] = useState<readonly string[] | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [last, setLast] = useState<string | null>(null) // the word just approved or fixed, to take back

  useEffect(() => {
    void import('../../lib/pronunciationSeed').then((m) => setSeed(m.SEED_WORDS))
  }, [])

  const done = useMemo(
    () => new Set([...BUILT_IN.map((b) => b.word), ...fixed.items.map((p) => p.word), ...approved.items.map((a) => a.word)]),
    [fixed.items, approved.items],
  )
  const ready = seed !== null && fixed.query.isSuccess && approved.query.isSuccess && fresh.query.isSuccess
  const queue = useMemo(() => {
    if (!ready) return []
    const q = reviewQueue(seed, fresh.items, done)
    return last && q.includes(last) ? [last, ...q.filter((w) => w !== last)] : q
  }, [ready, seed, fresh.items, done, last])
  const newCount = queue.filter((w) => fresh.items.some((n) => n.word === w)).length

  const run = async (writes: Promise<unknown>[]) => {
    setSaveError(null)
    try {
      await Promise.all(writes)
      return true
    } catch (e) {
      setSaveError(e)
      return false
    }
  }
  const leaveNew = (word: string) => (fresh.items.some((n) => n.word === word) ? [fresh.save(fresh.items.filter((n) => n.word !== word))] : [])
  const approve = async (word: string) => {
    const ok = await run([approved.save([...approved.items, { id: newId(), word }]), ...leaveNew(word)])
    if (ok) setLast(word)
    return ok
  }
  const fix = async (word: string, say: string) => {
    const ok = await run([fixed.save([...fixed.items.filter((p) => p.word !== word), { id: newId(), word, say }]), ...leaveNew(word)])
    if (ok) setLast(word)
    return ok
  }
  // Back to the word before: it leaves the approved or fixed list and comes first again.
  const undo = async () => {
    if (!last) return
    const writes = [
      ...(approved.items.some((a) => a.word === last) ? [approved.save(approved.items.filter((a) => a.word !== last))] : []),
      ...(fixed.items.some((p) => p.word === last) ? [fixed.save(fixed.items.filter((p) => p.word !== last))] : []),
    ]
    if (await run(writes)) setLast(null)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        {tx('שומעים מילה אחת בכל פעם, כמו ששלי אומר אותה. אם היא נשמעת נכון מאשרים, ואם לא, כותבים איך אומרים אותה (בעברית אחרת או באותיות באנגלית) ושומעים שוב עד שזה נכון. מילה חדשה ששלי יגיד ועוד לא שמעת תופיע כאן לבד.')}
      </p>
      {saveError != null && <DriveError error={saveError} action="save" />}
      {!ready ? (
        <p className="text-slate-400">{tx('טוען…')}</p>
      ) : (
        <Trainer
          queue={queue}
          newCount={newCount}
          heardCount={done.size}
          busy={fixed.saving || approved.saving || fresh.saving}
          onApprove={approve}
          onFix={fix}
          lastWord={last && done.has(last) ? last : null}
          onUndo={() => void undo()}
        />
      )}

      {fixed.items.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">{tx('מילים שתיקנת ({length})', { length: fixed.items.length })}</h2>
          <ul className="space-y-2">
            {fixed.items.map((p) => (
              <li key={p.id} className="flex min-h-14 items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{p.word}</span>
                  <span className="text-slate-400">{' ← '}</span>
                  <span dir="auto" className="text-slate-200">{p.say}</span>
                </span>
                {canSpeak && (
                  <button type="button" onClick={() => speak(p.word)} aria-label={tx('שמע איך שלי אומר את {v}', { v: p.word })} className="flex size-11 items-center justify-center rounded-xl text-slate-300">
                    <Volume2 size={18} aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void run([fixed.save(fixed.items.filter((x) => x.id !== p.id))])}
                  disabled={fixed.saving}
                  aria-label={tx('מחיקת {v}', { v: p.word })}
                  className="flex size-11 items-center justify-center rounded-xl text-slate-400 disabled:opacity-40"
                >
                  <X size={18} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">{tx('מחיקה מחזירה את המילה לאימון.')}</p>
        </section>
      )}
    </div>
  )
}

function Trainer({
  queue,
  newCount,
  heardCount,
  busy,
  onApprove,
  onFix,
  lastWord,
  onUndo,
}: {
  queue: string[]
  newCount: number
  heardCount: number
  busy: boolean
  onApprove: (word: string) => Promise<boolean>
  onFix: (word: string, say: string) => Promise<boolean>
  lastWord: string | null
  onUndo: () => void
}) {
  const [started, setStarted] = useState(false)
  const [skipped, setSkipped] = useState<string[]>([])
  const [fixing, setFixing] = useState(false)
  const [say, setSay] = useState('')
  const [error, setError] = useState<string | null>(null)
  const word = queue.find((w) => !skipped.includes(w)) ?? queue[0]

  // Each new word is said once as it appears (sound needs the first tap, so only after "start").
  useEffect(() => {
    if (started && word) speak(word)
    setFixing(false)
    setSay('')
    setError(null)
  }, [started, word])

  if (!word)
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-center">
        <p className="font-semibold">{tx('שמעת את כל המילים.')}</p>
        <p className="text-sm text-slate-400">{tx('מילים חדשות ששלי יגיד יופיעו כאן.')}</p>
      </section>
    )

  const progress = (
    <p className="text-sm text-slate-400">
      {tx('נשארו {v} מילים', { v: queue.length })}
      {newCount > 0 ? tx(', מהן {v} חדשות ששלי אמר', { v: newCount }) : ''}
      {tx('. כבר שמעת {v}.', { v: heardCount })}
    </p>
  )

  if (!started)
    return (
      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        {progress}
        <button type="button" onClick={() => setStarted(true)} className="min-h-12 w-full rounded-xl bg-sky-600 px-4 font-semibold text-white">
          {tx('התחל אימון')}
        </button>
      </section>
    )

  const saveFix = async () => {
    const err = pronunciationError(word, say)
    setError(err && (ERRORS[err] ?? null))
    if (err) return
    await onFix(word, say.trim())
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      {progress}
      <p className="py-2 text-center text-4xl font-bold">{word}</p>
      <button type="button" onClick={() => speak(word)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 text-slate-200">
        <Volume2 size={18} aria-hidden />
        {tx('שמע שוב')}
      </button>

      {!fixing ? (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void onApprove(word)} disabled={busy} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 font-semibold text-white disabled:opacity-50">
            <Check size={18} aria-hidden />
            {tx('נשמע נכון')}
          </button>
          <button type="button" onClick={() => setFixing(true)} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-amber-500 font-semibold text-amber-200">
            <PencilLine size={18} aria-hidden />
            {tx('לא נכון, לתקן')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-sm text-slate-300">{tx('איך לומר אותה')}</span>
            <input id="train-say" value={say} onChange={(e) => setSay(e.target.value)} placeholder={tx('למשל: Tapsan')} className={inputClass} autoComplete="off" autoFocus />
          </label>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => speak(say)} disabled={!say.trim()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 text-slate-200 disabled:opacity-40">
              <Volume2 size={18} aria-hidden />
              {tx('שמע את התיקון')}
            </button>
            <button type="button" onClick={() => void saveFix()} disabled={busy} className="min-h-11 rounded-xl bg-sky-600 font-semibold text-white disabled:opacity-50">
              {tx('שמור תיקון')}
            </button>
          </div>
          <button type="button" onClick={() => setFixing(false)} className="min-h-11 w-full text-sm text-slate-400">
            {tx('ביטול')}
          </button>
        </div>
      )}

      {lastWord && (
        <button type="button" onClick={onUndo} disabled={busy} className="flex min-h-11 w-full items-center justify-center gap-2 text-sm text-sky-300 disabled:opacity-40">
          <Undo2 size={16} aria-hidden />
          {tx('חזרה למילה הקודמת: {v}', { v: lastWord })}
        </button>
      )}
      <button type="button" onClick={() => setSkipped((s) => [...s, word])} className="flex min-h-11 w-full items-center justify-center gap-2 text-sm text-slate-400">
        <SkipForward size={16} aria-hidden />
        {tx('דלג, אחליט אחר כך')}
      </button>
    </section>
  )
}
