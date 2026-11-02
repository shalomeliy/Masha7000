import { describe, expect, it } from 'vitest'
import {
  BACKUP_LISTS,
  BackupError,
  backupCounts,
  backupDate,
  backupFileName,
  copiesToDelete,
  countsText,
  hasWeeklyCopy,
  makeBackup,
  parseBackup,
  toCopyInfo,
  weekStart,
} from './backup'
import type { CopyInfo } from './backup'

const data = {
  workers: [{ id: 'w1', firstName: 'דני', lastName: 'כהן', mobilePhone: '050', roleIds: [], certificationIds: [], constraints: [], status: 'active' }],
  shifts: [
    { id: 's1', date: '2026-10-20', location: 'חיפה', jobDescription: '', crew: [], staffing: [] },
    { id: 's2', date: '2026-10-21', location: '', jobDescription: '', crew: [], staffing: [] },
  ],
  pendingJobs: [{ id: 'p1', location: '', jobDescription: '', createdAt: '', reasonIds: [], staffing: [] }],
  roles: [{ id: 'general', name: 'כללי' }],
}
const now = new Date('2026-10-29T08:00:00Z')

describe('backup file', () => {
  it('round trips every list', () => {
    const b = makeBackup(data, now)
    const back = parseBackup(JSON.stringify(b))
    expect(back.createdAt).toBe(now.toISOString())
    expect(back.files.workers).toEqual(data.workers)
    expect(back.files.shifts).toEqual(data.shifts)
    expect(back.files.roles).toEqual(data.roles)
    for (const k of BACKUP_LISTS) expect(Array.isArray(back.files[k])).toBe(true)
  })

  it('keeps the departments, and gives a backup without them the starter list', () => {
    const departments = [{ id: 'd1', name: 'רחפנים' }]
    expect(parseBackup(JSON.stringify(makeBackup({ ...data, departments }, now))).files.departments).toEqual(departments)
    const b = makeBackup(data, now)
    expect(b.files.departments.map((d) => d.name)).toContain('תקשורת')
    const { departments: _, ...older } = b.files
    expect(parseBackup(JSON.stringify({ ...b, files: older })).files.departments).toHaveLength(6)
  })

  it('fills fields an older backup lacks, as the app does on read', () => {
    const b = makeBackup({ workers: [{ id: 'w1', name: 'דני כהן לוי' }], shifts: [{ id: 's1', date: '2026-01-01' }] }, now)
    const back = parseBackup(JSON.stringify(b))
    expect(back.files.workers[0]).toMatchObject({ firstName: 'דני', lastName: 'כהן לוי', roleIds: [], constraints: [] })
    expect(back.files.shifts[0]).toMatchObject({ crew: [], staffing: [], location: '' })
  })

  it.each([
    ['not JSON', 'hello'],
    ['another app', JSON.stringify({ app: 'other', version: 1, createdAt: now.toISOString(), files: {} })],
    ['an array', '[]'],
    ['no date', JSON.stringify({ ...makeBackup(data, now), createdAt: undefined })],
  ])('refuses %s', (_, text) => {
    expect(() => parseBackup(text)).toThrow(BackupError)
  })

  it('refuses a missing or broken list', () => {
    const b = makeBackup(data, now)
    const { places: _, ...files } = b.files
    expect(() => parseBackup(JSON.stringify({ ...b, files }))).toThrow(/מקומות/)
    expect(() => parseBackup(JSON.stringify({ ...b, files: { ...b.files, workers: [{ firstName: 'x' }] } }))).toThrow(/עובדים/)
    expect(() => parseBackup(JSON.stringify({ ...b, files: { ...b.files, shifts: [{ id: 'x' }] } }))).toThrow(/משמרות/)
    expect(() => parseBackup(JSON.stringify({ ...b, files: { ...b.files, roles: ['x'] } }))).toThrow(/תפקידים/)
    // A name that is not text would break the screen that shows it.
    expect(() => parseBackup(JSON.stringify({ ...b, files: { ...b.files, workers: [{ id: 'w', firstName: {} }] } }))).toThrow(/עובדים/)
  })

  it('refuses another version', () => {
    expect(() => parseBackup(JSON.stringify({ ...makeBackup(data, now), version: 2 }))).toThrow(/גרסה אחרת/)
  })

  it('counts what the preview shows', () => {
    const c = backupCounts(makeBackup(data, now))
    expect(c).toEqual({ workers: 1, shifts: 2, pendingJobs: 1 })
    expect(countsText(c)).toBe('עובד אחד, 2 משמרות, משימה אחת לשיבוץ')
    expect(countsText({ workers: 18, shifts: 412, pendingJobs: 6 })).toBe('18 עובדים, 412 משמרות, 6 משימות לשיבוץ')
  })

  it('names and dates the file', () => {
    expect(backupFileName(new Date(2026, 9, 30))).toBe('masha7000-backup-2026-10-30.json')
    expect(backupDate('2026-10-29T08:00:00Z')).toBe('29.10.2026')
  })
})

describe('automatic copies', () => {
  const copy = (id: string, kind: CopyInfo['kind'], createdAt: string): CopyInfo => ({ id, kind, createdAt, counts: { workers: 0, shifts: 0, pendingJobs: 0 } })

  it('starts the week on Sunday', () => {
    expect(weekStart(new Date(2026, 9, 31))).toBe('2026-10-25') // Saturday
    expect(weekStart(new Date(2026, 9, 25))).toBe('2026-10-25') // Sunday
    expect(weekStart(new Date(2026, 10, 1))).toBe('2026-11-01')
  })

  it('makes one weekly copy a week', () => {
    const copies = [copy('a', 'weekly', new Date(2026, 9, 26, 9).toISOString())]
    expect(hasWeeklyCopy(copies, new Date(2026, 9, 31))).toBe(true)
    expect(hasWeeklyCopy(copies, new Date(2026, 10, 1))).toBe(false)
    // A copy before a restore is not the week's copy.
    expect(hasWeeklyCopy([copy('b', 'beforeRestore', new Date(2026, 9, 27).toISOString())], new Date(2026, 9, 31))).toBe(false)
  })

  it('keeps the newest 8 weekly and 3 before-restore copies', () => {
    const weekly = Array.from({ length: 10 }, (_, i) => copy(`w${i}`, 'weekly', new Date(2026, 0, 1 + i * 7).toISOString()))
    const before = Array.from({ length: 4 }, (_, i) => copy(`b${i}`, 'beforeRestore', new Date(2026, 5, 1 + i).toISOString()))
    expect(copiesToDelete([...weekly, ...before]).map((c) => c.id)).toEqual(['w1', 'w0', 'b0'])
  })

  it('reads a Drive copy, ignoring other files', () => {
    const f = { id: '1', name: 'backup-weekly-x.json', createdTime: 't', appProperties: { kind: 'weekly', createdAt: '2026-10-29T08:00:00Z', workers: '18', shifts: '412', pendingJobs: '6' } }
    expect(toCopyInfo(f)).toEqual({ id: '1', kind: 'weekly', createdAt: '2026-10-29T08:00:00Z', counts: { workers: 18, shifts: 412, pendingJobs: 6 } })
    expect(toCopyInfo({ ...f, name: 'workers.json' })).toBeNull()
    expect(toCopyInfo({ ...f, appProperties: {} })).toBeNull()
  })
})
