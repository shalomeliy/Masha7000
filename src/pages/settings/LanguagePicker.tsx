import { Languages } from 'lucide-react'
import { language, setLanguage, tx } from '../../i18n'
import { LANGUAGES } from '../../i18n/languages'
import { ChoiceList } from '../../components/ChoiceList'

// The app's language, kept on this device. "Language" is also written in English, so someone who
// picked a language they cannot read can still find the way back.
export function LanguagePicker() {
  const now = language()
  const label = tx('שפה')
  const name = now.code === 'en' ? label : `${label} · Language`
  return (
    <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2">
      <div className="flex min-h-10 items-center gap-3">
        <Languages size={22} aria-hidden className="shrink-0 text-sky-300" />
        <span className="flex-1">
          <span className="block font-semibold">{name}</span>
          <span className="block text-xs text-slate-400">{tx('השפה של האפליקציה במכשיר הזה, גם של העוזר הקולי')}</span>
        </span>
      </div>
      <ChoiceList ariaLabel={name} value={now.code} onChange={setLanguage} options={LANGUAGES.map((l) => ({ value: l.code, label: l.name, lang: l.code, dir: l.dir }))} />
    </div>
  )
}
