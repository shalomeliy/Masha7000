import { BookOpen, Loader2, RotateCcw } from 'lucide-react'
import { tx } from '../../i18n'
import { FEATURE_IDS, featureHint, featureName, NEEDS, type FeatureId } from '../../lib/features'
import { useFeatures } from '../../lib/data/useFeatures'
import { authMode } from '../../lib/google/auth'
import { useOnboarding } from '../../store/onboarding'
import { FeatureRequestSection } from './FeatureRequestSection'

// Settings > "מסכים ותכונות": a switch per feature. Off only hides it; nothing is deleted.
// A feature that needs another one is greyed while that one is off.
export function FeaturesSection({ openGuide }: { openGuide: () => void }) {
  const { flags, setFeature, saving, loaded } = useFeatures()
  const reopen = useOnboarding((s) => s.open)
  if (!loaded)
    return (
      <p className="flex items-center gap-2 text-slate-400">
        <Loader2 size={18} className="animate-spin" aria-hidden />
        {tx('טוען...')}
      </p>
    )
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{tx('מסכים ותכונות')}</h1>
      <p className="text-sm text-slate-400">{tx('מה שכבוי לא מופיע באפליקציה וגם לא אצל Shali. שום דבר לא נמחק: מדליקים שוב והכול חוזר.')}</p>
      <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        {FEATURE_IDS.map((id) => (
          <FeatureRow key={id} id={id} on={flags[id]} blockedBy={blocked(id, flags)} disabled={saving} onChange={(on) => void setFeature(id, on)} />
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={reopen} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sky-300">
          <RotateCcw size={18} aria-hidden />
          {tx('לענות שוב על השאלות')}
        </button>
        <button type="button" onClick={openGuide} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sky-300">
          <BookOpen size={18} aria-hidden />
          {tx('מדריך')}
        </button>
      </div>
      {authMode() === 'server' && <FeatureRequestSection inline />}
    </div>
  )
}

const blocked = (id: FeatureId, flags: Record<FeatureId, boolean>): FeatureId | null => {
  const need = NEEDS[id]
  return need && !flags[need] ? need : null
}

export function FeatureRow({ id, on, blockedBy, disabled, onChange }: { id: FeatureId; on: boolean; blockedBy: FeatureId | null; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <li className={`flex items-center gap-3 p-4 ${blockedBy ? 'opacity-50' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{featureName(id)}</p>
        <p className="text-sm text-slate-400">{blockedBy ? tx('צריך קודם: {name}', { name: featureName(blockedBy) }) : featureHint(id)}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={featureName(id)}
        disabled={disabled || blockedBy !== null}
        onClick={() => onChange(!on)}
        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${on ? 'bg-sky-500' : 'bg-slate-700'}`}
      >
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${on ? 'start-7' : 'start-1'}`} aria-hidden />
      </button>
    </li>
  )
}
