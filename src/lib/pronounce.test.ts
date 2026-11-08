import { afterEach, describe, expect, it } from 'vitest'
import { applyPronunciations, isKnownWord, pronounce, pronunciationError, pronunciationTable, reviewQueue, unknownWords } from './pronounce'

afterEach(() => applyPronunciations([]))

describe('pronounce', () => {
  it('says טפסן the way the voice gets it right, also in plural', () => {
    expect(pronounce('צריך טפסן אחד')).toBe('צריך Tapsan אחד')
    expect(pronounce('שני טפסנים בלילה')).toBe('שני Tapsanim בלילה')
  })
  it('says the letters in front of the word too', () => {
    expect(pronounce('שמתי את הטפסן')).toBe('שמתי את ha Tapsan')
    expect(pronounce('חסר לטפסן כלי')).toBe('חסר le Tapsan כלי')
    expect(pronounce('ולטפסן')).toBe('ve le Tapsan')
  })
  it('keeps a Hebrew replacement glued to its letters', () => {
    expect(pronounce('ראיתי את השלי', [{ word: 'שלי', say: 'שאלי' }])).toBe('ראיתי את השאלי')
  })
  it('leaves words that only look alike', () => {
    expect(pronounce('אטפסן')).toBe('אטפסן')
    expect(pronounce('טפסני')).toBe('טפסני')
  })
  it("uses the manager's entry before the built-in one", () => {
    applyPronunciations([{ id: '1', word: 'טפסן', say: 'Tapssan' }, { id: '2', word: 'אביחי', say: 'Avichai' }])
    expect(pronounce('אביחי טפסן')).toBe('Avichai Tapssan')
    expect(pronunciationTable().filter((p) => p.word === 'טפסן')).toHaveLength(1)
  })
  it('checks a new entry', () => {
    expect(pronunciationError('', 'x')).toBe('word')
    expect(pronunciationError('טפסן', ' ')).toBe('say')
    expect(pronunciationError('טפסן', 'טפסן')).toBe('same')
    expect(pronunciationError('טפסן', 'Tapsan')).toBeNull()
  })
})

describe('training', () => {
  it('says a two-word entry as a whole', () => {
    expect(pronounce('נוסעים לבאר שבע מחר', [{ word: 'באר שבע', say: 'Beer Sheva' }])).toBe('נוסעים le Beer Sheva מחר')
    expect(pronounce('באר שבע', [{ word: 'באר שבע', say: 'Beer Sheva' }])).toBe('Beer Sheva')
  })
  it('finds words not known yet, also behind ו/ב/ל/ה', () => {
    const known = new Set(['עבודה', 'לילה'])
    expect(unknownWords('העבודה בלילה של אביחי, ואביחי בא', known)).toEqual(['של', 'אביחי', 'ואביחי', 'בא'])
    expect(isKnownWord('ולעבודה', known)).toBe(true)
  })
  it('puts new words first and leaves out what was heard', () => {
    expect(reviewQueue(['עבודה', 'לילה', 'יום'], [{ word: 'אביחי' }, { word: 'לילה' }], new Set(['לילה']))).toEqual(['אביחי', 'עבודה', 'יום'])
  })
})
