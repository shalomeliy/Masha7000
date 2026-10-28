// Data schemas from docs/input/02-technical-spec.md, section 3.

export interface Role {
  id: string
  name: string // e.g. "אחראי משמרת", "מוקדן"
}

export interface Constraint {
  id: string
  date: string // YYYY-MM-DD
  reason: string
}

export interface Worker {
  id: string
  name: string
  roleIds: string[] // roles the worker is certified for
  constraints: Constraint[]
}

export interface ShiftDefinition {
  id: string
  name: string // "בוקר", "צהריים", "לילה", "כוננות 24/7"
  isStandby?: boolean // standby shift staffed by exactly 3 people
  requiredHeadcount?: number // usually 1 for a regular shift, 3 for standby
  requiredRoleIds: string[]
  startTime: string // "07:00"
  endTime: string // "15:00"
}

export interface ShiftAssignment {
  id: string
  date: string // YYYY-MM-DD
  shiftDefinitionId: string
  assignedWorkerIds: string[]
  status: 'VALID' | 'HAS_CONFLICT' | 'MISSING_ROLE'
}

// Stored in Drive appDataFolder as settings.json. Not in the spec; holds ids we must remember.
export interface AppSettings {
  calendarId?: string
}
