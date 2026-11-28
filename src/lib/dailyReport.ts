import { tx } from '../i18n'
import { certStars, fullName, isActive, neededCerts, staffingFor } from './catalog'
import { expiryState } from './certExpiry'
import { blockedCrew, constraintText } from './constraints'
import { featureRules } from './featureRules'
import { crewPlaces, shiftGaps, type GapContext } from './gaps'
import { addDays, dayName, showDate, sortShifts } from './shifts'
import type { ShiftRecord, Worker } from '../types/models'

// The end-of-day report (the owner's request, 2026-11-28): what is wrong or missing, so nothing is
// forgotten before tomorrow. Pure and free: computed on the phone from the data already loaded,
// never sent anywhere. Step 1: tomorrow's and the day after's jobs, and missing data.
// The checks reuse the week gaps (src/lib/gaps.ts) and the constraints; features turned off for the team
// (certifications, their expiry, constraints) are not checked.

export type ReportGroup = 'urgent' | 'data'

export interface ReportItem {
  group: ReportGroup
  key: string
  text: string // "מחר בערד: חסר עובד אחד, דני כהן במחלה עד 30.11"
  shiftId?: string // tap opens the job
  workerId?: string // tap opens the worker
}

export const DEFAULT_REPORT_HOUR = '18:00'

/** Hours the manager can pick for the report, 12:00 to 23:00. */
export const REPORT_HOURS = Array.from({ length: 12 }, (_, i) => `${String(12 + i).padStart(2, '0')}:00`)

/** Is the report's hour reached today ("HH:mm", local time). */
export const reportDue = (now: Date, hour = DEFAULT_REPORT_HOUR) =>
  `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` >= hour

const whenText = (date: string, today: string) =>
  date === addDays(today, 1) ? tx('מחר') : `${dayName(date)} ${showDate(date)}`

const placeOf = (r: ShiftRecord) => r.location.trim() || tx('ללא מיקום')

/** What is wrong in one job of the next two days, as short phrases. */
function shiftProblems(r: ShiftRecord, ctx: GapContext): string[] {
  const byId = new Map(ctx.workers.map((w) => [w.id, w]))
  const name = (id: string) => (byId.has(id) ? fullName(byId.get(id)!) : tx('עובד שנמחק'))
  const g = shiftGaps(r, ctx)
  const out: string[] = []
  if (!r.crew.length && g.missing.length) out.push(tx('אין אף עובד משובץ'))
  else if (g.missing.length === 1) out.push(tx('חסר עובד אחד'))
  else if (g.missing.length > 1) out.push(tx('חסרים {n} עובדים', { n: g.missing.length }))
  for (const b of blockedCrew(r, ctx.workers, ctx.defs)) out.push(`${fullName(b.worker)} ${constraintText(b.constraint)}`)
  for (const c of r.crew) {
    const w = byId.get(c.workerId)
    if (w && !isActive(w)) out.push(tx('{name} לא פעיל', { name: fullName(w) }))
  }
  for (const id of g.doubleIds) out.push(tx('{name} משובץ גם בעבודה אחרת באותו זמן', { name: name(id) }))
  if (featureRules.certs && featureRules.certExpiry) {
    const staffing = staffingFor(r.staffing, ctx.certifications.map((c) => c.id))
    for (const [id, s] of crewPlaces(r, staffing, ctx.workers)) {
      const w = byId.get(id)!
      for (const certId of neededCerts(staffing[s])) {
        if (expiryState(w, certId, r.date) !== 'expired') continue
        const cert = ctx.certifications.find((c) => c.id === certId)?.name ?? ''
        out.push(tx('ההסמכה {cert} של {name} לא בתוקף ביום העבודה', { cert, name: fullName(w) }))
      }
    }
  }
  return out
}

/** What a worker's card is missing, as short phrases. */
function workerProblems(w: Worker, ctx: GapContext): string[] {
  const out: string[] = []
  if (!w.mobilePhone?.trim()) out.push(tx('אין טלפון נייד'))
  if (!w.emergencyPhone1?.trim()) out.push(tx('אין טלפון חירום'))
  if (!featureRules.certs) return out
  for (const cert of ctx.certifications) {
    if (!w.certificationIds.includes(cert.id)) continue
    if (certStars(w, cert.id) === 0) out.push(tx('אין כוכבים בהסמכה {cert}', { cert: cert.name }))
    if (featureRules.certExpiry && !cert.noExpiry && !w.certExpiry?.[cert.id]) out.push(tx('אין תאריך תוקף להסמכה {cert}', { cert: cert.name }))
  }
  return out
}

export function dailyReport(ctx: GapContext, today: string): ReportItem[] {
  const open = sortShifts(ctx.records.filter((r) => !r.closure && r.date >= today), ctx.defs)
  const soon = new Set([addDays(today, 1), addDays(today, 2)])
  const items: ReportItem[] = []
  for (const r of open.filter((x) => soon.has(x.date))) {
    const p = shiftProblems(r, ctx)
    if (p.length) items.push({ group: 'urgent', key: `u-${r.id}`, shiftId: r.id, text: `${whenText(r.date, today)} ${tx('ב{place}', { place: placeOf(r) })}: ${p.join(', ')}` })
  }
  for (const r of open) {
    const p = [...(r.location.trim() ? [] : [tx('אין מיקום')]), ...(r.jobDescription.trim() ? [] : [tx('אין תיאור עבודה')])]
    if (p.length) items.push({ group: 'data', key: `j-${r.id}`, shiftId: r.id, text: `${tx('עבודה')} ${whenText(r.date, today)}${r.location.trim() ? ` ${tx('ב{place}', { place: r.location.trim() })}` : ''}: ${p.join(', ')}` })
  }
  const people = ctx.workers.filter(isActive).sort((a, b) => fullName(a).localeCompare(fullName(b), 'he'))
  for (const w of people) {
    const p = workerProblems(w, ctx)
    if (p.length) items.push({ group: 'data', key: `w-${w.id}`, workerId: w.id, text: `${fullName(w)}: ${p.join(', ')}` })
  }
  return items
}

/** The report as Shali says it: the count, then the urgent lines; missing data only as a count. */
export function reportSpeech(items: ReportItem[]): string {
  if (!items.length) return tx('הדוח היומי נקי: אין חוסרים ואין בעיות למחר ולמחרתיים.')
  const urgent = items.filter((i) => i.group === 'urgent')
  const data = items.length - urgent.length
  const parts = [
    urgent.length === 0 ? tx('למחר ולמחרתיים הכל מסודר.') : urgent.length === 1 ? tx('בעיה אחת בעבודות הקרובות.') : tx('{n} עבודות קרובות עם בעיה.', { n: urgent.length }),
    ...urgent.map((i) => `${i.text}.`),
    data === 0 ? '' : data === 1 ? tx('ועוד פריט אחד של פרטים חסרים, במסך הדוח היומי.') : tx('ועוד {n} פריטים של פרטים חסרים, במסך הדוח היומי.', { n: data }),
  ]
  return parts.filter(Boolean).join(' ')
}
