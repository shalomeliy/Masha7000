import { describe, expect, it } from 'vitest'
import { asTaskList, oneLine, splitTasks } from './taskList'

describe('splitTasks', () => {
  it('splits at a task word joined with ו, keeping the words as said', () => {
    expect(splitTasks('החלפת נורה וניקוי עדשה')).toEqual(['החלפת נורה', 'ניקוי עדשה'])
    expect(splitTasks('תיקון מזגן, החלפת פילטר והתקנת מצלמה בכניסה')).toEqual(['תיקון מזגן', 'החלפת פילטר', 'התקנת מצלמה בכניסה'])
  })

  it('splits a task said right after another, with no ו', () => {
    expect(splitTasks('החלפת נורה תיקון מזגן')).toEqual(['החלפת נורה', 'תיקון מזגן'])
  })

  it('splits at ואז, בנוסף and וגם, and at "to do" forms', () => {
    expect(splitTasks('להחליף נורה ואז לנקות את העדשה')).toEqual(['להחליף נורה', 'לנקות את העדשה'])
    expect(splitTasks('להחליף נורה ולנקות עדשה')).toEqual(['להחליף נורה', 'לנקות עדשה'])
    expect(splitTasks('ריתוך מעקה וגם צביעה')).toEqual(['ריתוך מעקה', 'צביעה'])
  })

  it('keeps one task one', () => {
    expect(splitTasks('ניקוי עדשה')).toEqual(['ניקוי עדשה'])
    expect(splitTasks('ניקוי ושטיפה של עדשות')).toEqual(['ניקוי ושטיפה של עדשות'])
    expect(splitTasks('מבנה A, קומה 2')).toEqual(['מבנה A, קומה 2'])
    expect(splitTasks('ניקוי עדשה, בקומה 2')).toEqual(['ניקוי עדשה, בקומה 2'])
    expect(splitTasks('  ')).toEqual([])
  })

  it('reads a list already numbered, or one task a line', () => {
    expect(splitTasks('1. החלפת נורה\n2. ניקוי עדשה')).toEqual(['החלפת נורה', 'ניקוי עדשה'])
    expect(splitTasks('החלפת נורה\nמשהו אחר')).toEqual(['החלפת נורה', 'משהו אחר'])
  })
})

describe('asTaskList', () => {
  it('numbers more than one task, one a line', () => {
    expect(asTaskList('החלפת נורה וניקוי עדשה')).toBe('1. החלפת נורה\n2. ניקוי עדשה')
  })
  it('leaves one task as written, and a numbered list as it is', () => {
    expect(asTaskList(' ניקוי עדשה ')).toBe('ניקוי עדשה')
    expect(asTaskList('1. החלפת נורה\n2. ניקוי עדשה')).toBe('1. החלפת נורה\n2. ניקוי עדשה')
  })
  it('writes the list on one line for titles', () => {
    expect(oneLine('1. החלפת נורה\n2. ניקוי עדשה')).toBe('החלפת נורה, ניקוי עדשה')
  })
})
