import { useEffect, useState } from 'react'
import { tx } from '../../i18n'
import { ChoiceList } from '../../components/ChoiceList'
import { currentVoice, onVoicesChanged, pickVoice, speak, voiceName, voices } from '../../lib/speech'

// Shali's voice, picked here (owner, 2026-11-23: moved off the assistant screen, where a button cycled
// through them). In Hebrew the six cloud voices come first (Gemini, Chirp when Gemini fails), ענן 6 by
// default; then the phone's own voices. Picking one says a sample in it.
export function VoiceSection() {
  const [list, setList] = useState(voices)
  const [voice, setVoice] = useState(currentVoice)
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
    </div>
  )
}
