import { tx } from '../i18n'
import { GENERAL_ROLE_NAME, endsNextDay, fullName } from './catalog'
import { dayName, showDate, sortShifts, weekOf } from './shifts'
import { UNKNOWN_WORKER_COLOR, workerColors } from './workerColor'
import type { Role, ShiftDefinition, ShiftRecord, Worker } from '../types/models'
import { oneLine } from './taskList'

// The shifts of one day or one Sunday-to-Saturday week, as WhatsApp text and as the data the
// image card draws. Pure: the share sheet sends what these return.

export interface ReportContext {
  shifts: ShiftRecord[]
  defs: ShiftDefinition[]
  workers: Worker[]
  roles: Role[]
}

export type ShiftKind = 'urgent' | 'night' | 'day' | 'other'

export interface ReportShift {
  kind: ShiftKind
  kindLabel: string // "לילה", "דחופה מ-09:30"
  location: string
  until?: string // urgent only: "עד יום רביעי 4.11 16:00"
  job: string
  next?: string // "לינה": the job after the night, "place · work"
  crew: { name: string; role: string; color: string }[] // color: the worker's own, for the image
}

export interface ReportDay {
  date: string
  title: string // "יום רביעי 28.10"
  shifts: ReportShift[]
}

export interface Report {
  title: string // "סידור עבודות" / "סידור עבודות לשבוע"
  subtitle: string // the date or the week range ("1.11 עד 7.11.2026"), with the year
  days: ReportDay[]
}

const year = (date: string) => date.slice(0, 4)

/** "חיפה · החלפת אנטנה" for the job a "לינה" crew does after the night; undefined when there is none. */
export const nextJobText = (r: Pick<ShiftRecord, 'nextJob'>) =>
  [r.nextJob?.location, r.nextJob?.jobDescription && oneLine(r.nextJob.jobDescription)].filter(Boolean).join(' · ') || undefined

function reportShift(r: ShiftRecord, ctx: ReportContext, colors: Map<string, string>): ReportShift {
  const def = ctx.defs.find((d) => d.id === r.shiftDefinitionId)
  const kind: ShiftKind = r.urgent ? 'urgent' : !def ? 'other' : endsNextDay(def) ? 'night' : 'day'
  return {
    kind,
    kindLabel: r.urgent ? tx('דחופה מ-{startTime}', { startTime: r.startTime }) : (def?.name ?? tx('עבודה')),
    location: r.location,
    until: r.urgent && r.endDate ? tx('עד יום {weekday} {v2} {v3}', { weekday: dayName(r.endDate), v2: showDate(r.endDate), v3: r.endTime ?? '' }).trim() : undefined,
    job: r.jobDescription,
    next: nextJobText(r),
    crew: r.crew.map((c) => {
      const w = ctx.workers.find((x) => x.id === c.workerId)
      return {
        name: w ? fullName(w) : tx('עובד שנמחק'),
        role: ctx.roles.find((x) => x.id === c.roleId)?.name ?? GENERAL_ROLE_NAME,
        color: colors.get(c.workerId) ?? UNKNOWN_WORKER_COLOR,
      }
    }),
  }
}

function reportDay(date: string, ctx: ReportContext): ReportDay {
  const shifts = sortShifts(ctx.shifts).filter((r) => r.date === date)
  // Colors from the whole worker list, so a worker keeps theirs whoever else works that day.
  const colors = workerColors(ctx.workers)
  return { date, title: tx('יום {weekday} {v2}', { weekday: dayName(date), v2: showDate(date) }), shifts: shifts.map((r) => reportShift(r, ctx, colors)) }
}

export function dayData(date: string, ctx: ReportContext): Report {
  return { title: tx('סידור עבודות'), subtitle: tx('יום {weekday}, {v2}.{v3}', { weekday: dayName(date), v2: showDate(date), v3: year(date) }), days: [reportDay(date, ctx)] }
}

export function weekData(anyDay: string, ctx: ReportContext): Report {
  const week = weekOf(anyDay)
  return {
    title: tx('סידור עבודות לשבוע'),
    // A Hebrew word between the dates: "1.11 - 7.11" shows reversed in a right-to-left line.
    subtitle: tx('{v} עד {v2}.{v3}', { v: showDate(week.start), v2: showDate(week.end), v3: year(week.end) }),
    days: week.days.map((d) => reportDay(d, ctx)),
  }
}

// WhatsApp formatting: *bold*, _italic_. The icons stand in for the colors of the app.
export const KIND_ICON: Record<ShiftKind, string> = { urgent: '⚡', night: '🌙', day: '☀️', other: '🛠️' }
const LINE = '━━━━━━━━━━━━━━'

function shiftText(s: ReportShift): string[] {
  const lines = [`${KIND_ICON[s.kind]} *${s.kindLabel}*${s.location ? `  ·  📍 *${s.location}*` : ''}`]
  if (s.until) lines.push(`⏰ ${s.until}`)
  if (s.job) lines.push(`🔧 ${s.job}`)
  if (s.next) lines.push(tx('➡️ אחרי הלילה: {next}', { next: s.next }))
  if (s.crew.length === 0) lines.push(tx('⚠️ _עוד לא שובצו עובדים_'))
  else lines.push(tx('👷 *צוות ({length}):*', { length: s.crew.length }), ...s.crew.map((c) => `   • ${c.name} · _${c.role}_`))
  return lines
}

function dayText(day: ReportDay): string[] {
  if (day.shifts.length === 0) return [tx('_אין עבודות_')]
  return day.shifts.flatMap((s, i) => [...(i ? [''] : []), ...shiftText(s)])
}

export function reportText(report: Report): string {
  const head = [`📋 *${report.title}*`, `*${report.subtitle}*`, LINE]
  if (report.days.length === 1) return [...head, '', ...dayText(report.days[0]), '', LINE].join('\n')
  const body = report.days.flatMap((d) => ['', `🗓️ *${d.title}*`, ...dayText(d)])
  return [...head, ...body, '', LINE].join('\n')
}

export const dayReport = (date: string, ctx: ReportContext) => reportText(dayData(date, ctx))
export const weekReport = (anyDay: string, ctx: ReportContext) => reportText(weekData(anyDay, ctx))

/** Opens WhatsApp with the text ready; the manager picks the chat or group there. */
export const whatsappHref = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`
