import { GENERAL_ROLE_NAME, fullName } from './catalog'
import { dayName, showDate, sortShifts, weekOf } from './shifts'
import type { Role, ShiftDefinition, ShiftRecord, Worker } from '../types/models'

// WhatsApp-ready Hebrew text of the shifts of one day or one Sunday-to-Saturday week.
// *text* is bold in WhatsApp. Pure: the share sheet sends what these return.

export interface ReportContext {
  shifts: ShiftRecord[]
  defs: ShiftDefinition[]
  workers: Worker[]
  roles: Role[]
}

const year = (date: string) => date.slice(0, 4)

function shiftLines(r: ShiftRecord, n: number, ctx: ReportContext): string[] {
  const def = ctx.defs.find((d) => d.id === r.shiftDefinitionId)
  const kind = [r.urgent ? `דחופה מ-${r.startTime}` : '', def?.name ?? ''].filter(Boolean).join(' · ')
  const title = [kind, r.location].filter(Boolean).join(' - ') || 'משמרת'
  const lines = [`*${n}. ${title}*`]
  if (r.urgent && r.endDate) lines.push(`עד יום ${dayName(r.endDate)} ${showDate(r.endDate)} ${r.endTime ?? ''}`.trim())
  if (r.jobDescription) lines.push(`עבודה: ${r.jobDescription}`)
  if (r.crew.length === 0) {
    lines.push('עובדים: עוד לא שובצו')
  } else {
    lines.push('עובדים:')
    for (const c of r.crew) {
      const w = ctx.workers.find((x) => x.id === c.workerId)
      const role = ctx.roles.find((x) => x.id === c.roleId)?.name ?? GENERAL_ROLE_NAME
      lines.push(`- ${w ? fullName(w) : 'עובד שנמחק'} (${role})`)
    }
  }
  return lines
}

function dayBody(day: string, ctx: ReportContext): string[] {
  const list = sortShifts(ctx.shifts).filter((r) => r.date === day)
  if (list.length === 0) return ['אין משמרות']
  return list.flatMap((r, i) => [...(i ? [''] : []), ...shiftLines(r, i + 1, ctx)])
}

export function dayReport(day: string, ctx: ReportContext): string {
  return [`*משמרות יום ${dayName(day)} ${showDate(day)}.${year(day)}*`, '', ...dayBody(day, ctx)].join('\n')
}

export function weekReport(anyDay: string, ctx: ReportContext): string {
  const week = weekOf(anyDay)
  const lines = [`*סידור משמרות לשבוע ${showDate(week.start)} - ${showDate(week.end)}.${year(week.end)}*`]
  for (const day of week.days) lines.push('', `*יום ${dayName(day)} ${showDate(day)}*`, ...dayBody(day, ctx))
  return lines.join('\n')
}

/** Opens WhatsApp with the text ready; the manager picks the chat or group there. */
export const whatsappHref = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`
