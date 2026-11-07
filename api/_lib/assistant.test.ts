import { describe, expect, it } from 'vitest'
import { earlyText } from './assistant.js'

describe('earlyText', () => {
  it('waits until the spoken string is complete, then reads escapes', () => {
    expect(earlyText('advise', '{"spoken":"דני חולה, אז')).toBeNull()
    expect(earlyText('advise', String.raw`{"spoken":"דני \"חולה\", אז נדחה","opt`)).toBe('דני "חולה", אז נדחה')
    expect(earlyText('ask_user', '{"question": "מתי?"')).toBe('מתי?')
  })
  it('never for a proposal', () => expect(earlyText('propose', '{"summary":"x"')).toBeNull())
})
