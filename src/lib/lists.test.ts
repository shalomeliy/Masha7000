import { afterEach, describe, expect, it } from 'vitest'
import { addWord, applyWordSettings, BUILT_IN, groupWords, removeWord, wordError } from './constraintWords'
import { readAnswer } from './constraints'
import { renameText, suggestions, textUsage, usedTexts } from './lists'
import type { PendingJob, ShiftRecord } from '../types/models'

const shift = (location: string, jobDescription = ''): ShiftRecord => ({ id: location + jobDescription, date: '2026-11-01', location, jobDescription, crew: [], staffing: [] })
const job = (location: string): PendingJob => ({ id: location, location, jobDescription: '', staffing: [], reasonIds: [], createdAt: '' })

describe('places and kinds of work', () => {
  const shifts = [shift('חיפה'), shift(' חיפה '), shift('עכו')]
  const jobs = [job('חיפה')]

  it('counts and renames only the exact text, ignoring spaces around it', () => {
    expect(textUsage('location', 'חיפה', shifts, jobs)).toEqual({ shifts: 2, jobs: 1 })
    const next = renameText('location', 'חיפה', 'חיפה מפרץ', shifts, jobs)
    expect(next.shifts.map((s) => s.location)).toEqual(['חיפה מפרץ', 'חיפה מפרץ', 'עכו'])
    expect(next.jobs[0].location).toBe('חיפה מפרץ')
  })

  it('returns the same arrays when nothing holds the old text', () => {
    const next = renameText('location', 'אילת', 'אילת דרום', shifts, jobs)
    expect(next.shifts).toBe(shifts)
    expect(next.jobs).toBe(jobs)
  })

  it('collects texts already written, most used first, without known ones or long notes', () => {
    const all = [...shifts, shift('עכו'), shift('עכו'), shift('שורה\nשנייה'), shift('')]
    expect(usedTexts('location', all, jobs)).toEqual(['חיפה', 'עכו'])
    expect(usedTexts('location', all, jobs, [{ name: 'עכו' }])).toEqual(['חיפה'])
  })

  it('suggests names holding what was typed, none when it already matches', () => {
    expect(suggestions('חי', ['חיפה', 'עכו', 'נחיל'])).toEqual(['חיפה', 'נחיל'])
    expect(suggestions('', ['חיפה', 'עכו'])).toEqual(['חיפה', 'עכו'])
    expect(suggestions('עכו ', ['חיפה', 'עכו'])).toEqual([])
  })
})

describe('constraint words', () => {
  afterEach(() => applyWordSettings([]))

  it('adds a new word, and a taken-out built-in word comes back instead of being added', () => {
    const s = addWord('events', undefined, ' פסטיבל ')
    expect(s.added).toEqual(['פסטיבל'])
    const out = removeWord('events', s, 'חינה')
    expect(out.removed).toEqual(['חינה'])
    expect(groupWords('events', out)).not.toContain('חינה')
    expect(addWord('events', out, 'חינה').removed).toEqual([])
    expect(removeWord('events', s, 'פסטיבל').added).toEqual([])
  })

  it('refuses one letter and a word already there', () => {
    expect(wordError('א', [])).toBeTruthy()
    expect(wordError('חתונ', BUILT_IN.events as string[])).toBeTruthy()
    expect(wordError('פסטיבל', BUILT_IN.events as string[])).toBeNull()
  })

  it('the reader uses the manager words, and goes back to the built-in ones', () => {
    expect(readAnswer('פסטיבל').guess).toBe(true)
    applyWordSettings([addWord('events', undefined, 'פסטיבל'), removeWord('wholeDay', undefined, 'חופש')])
    expect(readAnswer('פסטיבל')).toMatchObject({ part: 'evening', cause: 'פסטיבל' })
    expect(readAnswer('חופש').part).toBeUndefined()
    expect(readAnswer('חופש').cause).toBeUndefined()
    applyWordSettings([])
    expect(readAnswer('פסטיבל').guess).toBe(true)
    expect(readAnswer('חופש').cause).toBe('חופש')
  })
})
