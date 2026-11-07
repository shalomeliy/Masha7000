import { describe, expect, it } from 'vitest'
import { closeName, latinToHebrew, nameDistance } from './nameMatch'

describe('names compared by sound', () => {
  it('spells English names in Hebrew the way they sound', () => {
    expect(latinToHebrew('Yossi')).toBe('יוסי')
    expect(latinToHebrew('Dani')).toBe('דני')
    expect(latinToHebrew('Moshe')).toBe('מושה')
    expect(latinToHebrew('Eli')).toBe('אלי')
    expect(latinToHebrew('Dana')).toBe('דנה')
  })

  it('vowel letters and sound-alike letters cost half', () => {
    expect(nameDistance('משה', 'מושה')).toBe(0.5)
    expect(nameDistance('תורגמן', "תורג'מן")).toBe(0)
    expect(nameDistance('טורגמן', 'תורגמן')).toBe(0.5)
    expect(nameDistance('מיכאל', 'Michael')).toBe(1)
    expect(nameDistance('אלי', 'אבי')).toBe(1)
  })

  it('short names must be almost exact', () => {
    expect(closeName('רון', 'רן')).toBe(false) // רן is too short to differ at all
    expect(closeName('רונן', 'רון')).toBe(false)
    expect(closeName('אמי', 'אלי')).toBe(false)
    expect(closeName('יוסיי', 'יוסי')).toBe(true)
    expect(closeName('Yossi', 'יוסי')).toBe(true)
    expect(closeName('דייויד', 'David')).toBe(true)
  })
})
