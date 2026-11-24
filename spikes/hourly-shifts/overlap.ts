// Spike (throwaway): can "שבץ" tell a worker is busy by HOURS instead of by whole days, without changing
// anything for a team that keeps the old day / night-until-16:00 types?
// Riskiest assumption: one interval check covers shifts that cross midnight, urgent shifts and rest time,
// and the old day-based rule stays byte-for-byte the same when the team has no hourly shifts.

import { busyWith as dayBusyWith } from '../../src/lib/planner'
import { addDays } from '../../src/lib/shifts'
import type { ShiftDefinition, ShiftRecord } from '../../src/types/models'

const minutes = (date: string, hhmm: string) => {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  return Date.UTC(y, m - 1, d, h, mi) / 60_000
}

/** [start, end) of a shift in minutes. A type whose end is not after its start ends the next day. */
export function interval(r: ShiftRecord, defs: ShiftDefinition[]): [number, number] {
  const def = defs.find((d) => d.id === r.shiftDefinitionId)
  const startTime = r.startTime ?? def?.startTime ?? '07:00'
  const endTime = r.endTime ?? def?.endTime ?? '16:00'
  const endDate = r.endDate ?? (def && (def.endsNextDay ?? def.endTime <= def.startTime) ? addDays(r.date, 1) : r.date)
  return [minutes(r.date, startTime), minutes(endDate, endTime)]
}

/** Busy by hours: another shift overlaps, or leaves less than `restHours` between them. */
export function hourBusyWith(workerId: string, shift: ShiftRecord, records: ShiftRecord[], defs: ShiftDefinition[], restHours = 0) {
  const [a, b] = interval(shift, defs)
  const rest = restHours * 60
  return records.find((r) => {
    if (r.id === shift.id || !r.crew.some((c) => c.workerId === workerId)) return false
    const [c, d] = interval(r, defs)
    return c < b + rest && d + rest > a
  })
}

/** The switch: a team with hourly shifts gets the hour check, every other team the old day check unchanged. */
export const busyWith = (hourly: boolean, workerId: string, shift: ShiftRecord, records: ShiftRecord[], defs: ShiftDefinition[], restHours = 0) =>
  hourly ? hourBusyWith(workerId, shift, records, defs, restHours) : dayBusyWith(workerId, shift, records, defs)
