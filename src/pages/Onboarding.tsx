import { useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { tx } from '../i18n'
import { answersToFeatures, FEATURE_IDS, NEEDS, resolveFeatures, suggestedAnswers, suggestsDepartments, withFeature, type Answers, type FeatureId } from '../lib/features'
import { useSaveSettings, useSettings } from '../lib/data/useFeatures'
import { authMode } from '../lib/google/auth'
import { useOnboarding } from '../store/onboarding'
import { FeatureRow } from './settings/FeaturesSection'

// Smart onboarding (docs/specs/smart-onboarding.md): one question per screen, answered with a tap,
// then "זה מה שיופיע לך" with a switch per feature, then saved to the team's settings.json.
// A new team sees it once; Settings > מסכים ותכונות > "לענות שוב על השאלות" opens it again.

type Key = keyof Answers
interface Question {
  key: Key
  title: string
  options: { id: string; label: string }[]
}

const questions = (): Question[] => [
  {
    key: 'business',
    title: tx('במה העסק שלך עוסק?'),
    options: [
      { id: 'field', label: tx('עבודות שטח') },
      { id: 'security', label: tx('אבטחה ושמירה') },
      { id: 'maintenance', label: tx('תחזוקה וטכנאים') },
      { id: 'other', label: tx('אחר') },
    ],
  },
  {
    key: 'size',
    title: tx('כמה עובדים יש לך?'),
    options: [
      { id: 'upTo10', label: tx('עד 10') },
      { id: 'upTo30', label: tx('11 עד 30') },
      { id: 'upTo100', label: tx('31 עד 100') },
      { id: 'more', label: tx('יותר מ-100') },
    ],
  },
  {
    key: 'shifts',
    title: tx('אילו עבודות יש אצלך?'),
    options: [
      { id: 'day', label: tx('רק עבודות יום (עד 16:00)') },
      { id: 'dayNight', label: tx('יום, וגם לילה עד מחר ב-16:00') },
    ],
  },
  {
    key: 'certs',
    title: tx('העובדים צריכים הסמכות או אישורים?'),
    options: [
      { id: 'withExpiry', label: tx('כן, עם תאריך תוקף') },
      { id: 'noExpiry', label: tx('כן, בלי תוקף') },
      { id: 'no', label: tx('לא') },
    ],
  },
  { key: 'vehicles', title: tx('העובדים יוצאים עם רכבי החברה?'), options: yesNo() },
  { key: 'departments', title: tx('העובדים מחולקים למחלקות או צוותים?'), options: yesNo() },
  {
    key: 'constraints',
    title: tx('איך העובדים מוסרים אילוצים?'),
    options: [
      { id: 'none', label: tx('לא מוסרים') },
      { id: 'tellMe', label: tx('אומרים לי, ואני רושם') },
      { id: 'weeklyForm', label: tx('טופס שבועי בוואטסאפ') },
    ],
  },
  {
    key: 'join',
    title: tx('עובדים חדשים ממלאים פרטים בעצמם?'),
    options: [
      { id: 'link', label: tx('כן, בקישור ששולחים להם') },
      { id: 'iType', label: tx('לא, אני מקליד') },
    ],
  },
  { key: 'closing', title: tx('בסוף עבודה רוצה לסמן אם הושלמה, ולראות דוחות?'), options: yesNo() },
  { key: 'shali', title: tx('רוצה לנהל בקול עם Shali?'), options: yesNo() },
]

function yesNo() {
  return [
    { id: 'yes', label: tx('כן') },
    { id: 'no', label: tx('לא') },
  ]
}

const NO_QUESTION: FeatureId[] = ['api', 'journal', 'quickLists']

export function Onboarding() {
  const settings = useSettings()
  const save = useSaveSettings()
  const close = useOnboarding((s) => s.close)
  const forced = useOnboarding((s) => s.forced)
  const previous = (settings.data?.onboarding?.answers ?? {}) as Answers
  const [answers, setAnswers] = useState<Answers>(previous)
  const [name, setName] = useState(settings.data?.onboarding?.businessName ?? '')
  const [step, setStep] = useState(0) // 0 = business name; 1..n = questions; n+1 = missing something; n+2 = summary
  const [flags, setFlags] = useState<Record<FeatureId, boolean> | null>(null)
  const [missing, setMissing] = useState('')
  const [error, setError] = useState<string | null>(null)
  const all = questions()
  const total = all.length + 2

  const pick = (q: Question, id: string) => {
    let next = { ...answers, [q.key]: id } as Answers
    // The kind of business suggests the answers still open (the manager can change each one).
    if (q.key === 'business') next = { ...suggestedAnswers(id as NonNullable<Answers['business']>), ...answers, business: id as Answers['business'] }
    if (q.key === 'size' && next.departments === undefined && suggestsDepartments(next.size)) next.departments = 'yes'
    setAnswers(next)
    setStep(step + 1)
  }

  const toSummary = () => {
    const next = answersToFeatures(answers)
    // Answering again: what has no question (API, journal, quick lists) keeps how the team has it now.
    if (settings.data?.onboarding) {
      const now = resolveFeatures(settings.data)
      for (const id of NO_QUESTION) next[id] = now[id]
    }
    setFlags(next)
    setStep(total)
  }

  const finish = async () => {
    if (!flags) return
    setError(null)
    try {
      await save.mutateAsync({
        features: flags,
        onboarding: { version: 1, answers: answers as Record<string, string>, doneAt: new Date().toISOString(), ...(name.trim() ? { businessName: name.trim().slice(0, 80) } : {}) },
      })
      // "חסר לך משהו?" goes to the app's maker like a feature request; a failure here does not stop the manager.
      if (missing.trim() && authMode() === 'server')
        void fetch('/api/feedback', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `${tx('מהאשף')}: ${missing.trim().slice(0, 3900)}` }),
        }).catch(() => {})
      close()
    } catch {
      setError(tx('השמירה לא הצליחה. בדוק את החיבור ונסה שוב.'))
    }
  }

  const back = step > 0 && (
    <button type="button" onClick={() => setStep(step - 1)} className="flex min-h-11 items-center gap-1 text-sky-300">
      <ChevronRight size={20} aria-hidden />
      {tx('הקודם')}
    </button>
  )

  return (
    <main className="mx-auto min-h-full max-w-md space-y-6 px-4 pt-6 pb-10">
      <div className="flex min-h-11 items-center justify-between">
        {back || <span />}
        <span className="flex items-center gap-3">
          <span className="text-sm text-slate-400">{tx('שלב {n} מתוך {total}', { n: Math.min(step + 1, total + 1), total: total + 1 })}</span>
          {forced && (
            <button type="button" onClick={close} className="min-h-11 px-2 text-sky-300">
              {tx('ביטול')}
            </button>
          )}
        </span>
      </div>

      {step === 0 && (
        <section className="space-y-4">
          <h1 className="text-2xl font-bold">{tx('ברוך הבא! כמה שאלות קצרות, ונתאים את האפליקציה לעסק שלך')}</h1>
          <p className="text-slate-400">{tx('בערך 2 דקות. כל תשובה אפשר לשנות אחר כך בהגדרות.')}</p>
          <label className="block space-y-2">
            <span className="font-medium">{tx('איך קוראים לעסק?')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="min-h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3" />
          </label>
          <button type="button" onClick={() => setStep(1)} className="min-h-12 w-full rounded-xl bg-sky-500 font-semibold text-slate-950">
            {tx('מתחילים')}
          </button>
        </section>
      )}

      {step >= 1 && step <= all.length && (
        <Ask q={all[step - 1]} chosen={answers[all[step - 1].key]} onPick={(id) => pick(all[step - 1], id)} />
      )}

      {step === all.length + 1 && (
        <section className="space-y-4">
          <h1 className="text-2xl font-bold">{tx('חסר לך משהו?')}</h1>
          <p className="text-slate-400">{tx('לא חובה. מה שתכתוב יישלח למפתח כבקשת תכונה.')}</p>
          <textarea value={missing} onChange={(e) => setMissing(e.target.value)} rows={4} maxLength={3900} className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3" />
          <button type="button" onClick={toSummary} className="min-h-12 w-full rounded-xl bg-sky-500 font-semibold text-slate-950">
            {missing.trim() ? tx('המשך') : tx('אין, המשך')}
          </button>
        </section>
      )}

      {step === total && flags && (
        <section className="space-y-4">
          <h1 className="text-2xl font-bold">{tx('זה מה שיופיע לך')}</h1>
          <p className="text-slate-400">{tx('אפשר לתקן כאן, וגם אחר כך בהגדרות > מסכים ותכונות. יומן, עובדים, "שבץ" וגיבוי תמיד דלוקים.')}</p>
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            {FEATURE_IDS.map((id) => {
              const need = NEEDS[id]
              return <FeatureRow key={id} id={id} on={flags[id]} blockedBy={need && !flags[need] ? need : null} onChange={(on) => setFlags(withFeature(flags, id, on))} />
            })}
          </ul>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <button type="button" disabled={save.isPending} onClick={() => void finish()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 font-semibold text-slate-950 disabled:opacity-60">
            {save.isPending && <Loader2 size={18} className="animate-spin" aria-hidden />}
            {tx('סיום, בוא נתחיל')}
          </button>
        </section>
      )}
    </main>
  )
}

function Ask({ q, chosen, onPick }: { q: Question; chosen: string | undefined; onPick: (id: string) => void }) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{q.title}</h1>
      <div className="space-y-3">
        {q.options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={chosen === o.id}
            onClick={() => onPick(o.id)}
            className={`min-h-14 w-full rounded-xl border px-4 text-start text-lg ${chosen === o.id ? 'border-sky-400 bg-sky-500/15 text-sky-100' : 'border-slate-700 bg-slate-900'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </section>
  )
}
