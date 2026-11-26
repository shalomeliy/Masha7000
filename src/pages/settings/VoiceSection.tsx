import { useEffect, useState } from 'react'
import { tx } from '../../i18n'
import { ChoiceList } from '../../components/ChoiceList'
import { bargeInOn, canBargeIn, setBargeIn } from '../../lib/bargeIn'
import { currentVoice, isIOS, onVoicesChanged, pickVoice, speak, voiceName, voices } from '../../lib/speech'

// Shali's voice, picked here (owner, 2026-11-23: moved off the assistant screen, where a button cycled
// through them). In Hebrew the six cloud voices come first (Gemini, Chirp when Gemini fails), ענן 6 by
// default; then the phone's own voices. Picking one says a sample in it.
export function VoiceSection() {
  const [list, setList] = useState(voices)
  const [voice, setVoice] = useState(currentVoice)
  const [barge, setBarge] = useState(bargeInOn)
  useEffect(
    () =>
      onVoicesChanged(() => {
        setList(voices())
        setVoice(currentVoice())
      }),
    [],
  )
  const phone = tx('קולות הטלפון')
  return (
    <div className="space-y-3">
      <ChoiceList
        label={tx('קול של Shali')}
        value={voice?.id ?? ''}
        options={list.map((v) => ({ value: v.id, label: voiceName(v), group: v.device ? phone : undefined }))}
        onChange={(id) => {
          setVoice(pickVoice(id))
          speak(`Shali. ${tx('ככה נשמע הקול הזה')}`)
        }}
      />
      <p className="text-sm text-slate-400">{tx('בחירה משמיעה דוגמה. הקול נשמר בטלפון הזה.')}</p>
      {/* Talking over Shali cuts it off (an experiment, 2026-11-27; src/lib/bargeIn.ts). Not on iPhone. */}
      {canBargeIn(isIOS) && (
        <div className="flex items-center gap-3 pt-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{tx('קטיעה בקול (ניסוי)')}</p>
            <p className="text-sm text-slate-400">{tx('כש-Shali מדבר, אפשר לדבר מעליו: הוא עוצר ומקשיב. אם הוא נעצר לבד באמצע, כבה את זה.')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={barge}
            aria-label={tx('קטיעה בקול (ניסוי)')}
            onClick={() => {
              setBargeIn(!barge)
              setBarge(!barge)
            }}
            className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${barge ? 'bg-sky-500' : 'bg-slate-700'}`}
          >
            <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${barge ? 'start-7' : 'start-1'}`} aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}
