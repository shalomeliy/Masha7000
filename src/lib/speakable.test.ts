import { describe, expect, it } from 'vitest'
import { rankVoices, shortVoiceName, speakable, speaksLanguage } from './speakable'

const v = (name: string, lang = 'he-IL') => ({ name, lang, localService: true, voiceURI: name })

describe('speakable', () => {
  it('reads a short date as day and month name', () => {
    expect(speakable('רשום חולה עד 15.11.', 'he-IL')).toBe('רשום חולה עד 15 בנובמבר.')
    expect(speakable('ב-3/12 יש עבודה', 'he-IL')).toBe('ב-3 בדצמבר יש עבודה')
  })
  it('reads full and ISO dates with the year', () => {
    expect(speakable('15.11.2026', 'he-IL')).toContain('2026')
    expect(speakable('2026-11-15', 'he-IL')).toContain('בנובמבר')
  })
  it('leaves numbers that are not dates', () => {
    expect(speakable('ב 1301', 'he-IL')).toBe('ב 1301')
    expect(speakable('40.5 שעות', 'he-IL')).toBe('40.5 שעות')
    expect(speakable('35.13', 'he-IL')).toBe('35.13')
    expect(speakable('עוד 1.5 שעות', 'he-IL')).toBe('עוד 1.5 שעות')
  })
  it('drops the leading zero of an hour', () => {
    expect(speakable('מתחיל ב-07:00', 'he-IL')).toBe('מתחיל ב-7:00')
    expect(speakable('עד 17:30', 'he-IL')).toBe('עד 17:30')
  })
  it('removes symbols and emojis a voice would spell out', () => {
    expect(speakable('**דני** -> משה ✅', 'he-IL')).toBe('דני, משה')
  })
})

describe('voices', () => {
  it('finds Hebrew voices named he or iw', () => {
    expect(speaksLanguage(v('a', 'iw-IL'), 'he')).toBe(true)
    expect(speaksLanguage(v('a', 'he_IL'), 'he')).toBe(true)
    expect(speaksLanguage(v('a', 'en-US'), 'he')).toBe(false)
  })
  it('puts natural and enhanced voices first', () => {
    const list = [v('Microsoft Asaf - Hebrew (Israel)'), v('Samantha', 'en-US'), v('Microsoft Hila Online (Natural) - Hebrew (Israel)'), v('Carmit')]
    expect(rankVoices(list, 'he').map((x) => x.name)).toEqual(['Microsoft Hila Online (Natural) - Hebrew (Israel)', 'Microsoft Asaf - Hebrew (Israel)', 'Carmit'])
  })
  it('shows a short name', () => {
    expect(shortVoiceName(v('Microsoft Hila Online (Natural) - Hebrew (Israel)'))).toBe('Hila Online')
    expect(shortVoiceName(v('Carmit (משופר)'))).toBe('Carmit')
    expect(shortVoiceName(v('Google עברית'))).toBe('עברית')
  })
})
