import { GENERAL_CERT_ID, MAX_STARS } from './normalize.js'

// Checks for what an outside caller sends. A bad field is refused with its name (422). Things the
// app itself allows with a warning (a worker already in another job that day, a worker without the
// certification a place asks for) are written and come back as warnings.

export class Invalid extends Error {
  field: string
  constructor(field: string, message: string) {
    super(message)
    this.field = field
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
export const TEXT_MAX = 500
export const MAX_STAFF = 20

export function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export function date(body: Record<string, unknown>, field: string, required = false): string | undefined {
  const v = body[field]
  if (v === undefined || v === null || v === '') {
    if (required) throw new Invalid(field, 'required, YYYY-MM-DD')
    return undefined
  }
  if (!isDate(v)) throw new Invalid(field, 'must be a date, YYYY-MM-DD')
  return v
}

export function text(body: Record<string, unknown>, field: string): string | undefined {
  const v = body[field]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new Invalid(field, 'must be text')
  if (v.length > TEXT_MAX) throw new Invalid(field, `at most ${TEXT_MAX} characters`)
  return v.trim()
}

/** A list of ids, each one of `known`; duplicates refused. */
export function idList(body: Record<string, unknown>, field: string, known: Set<string>, max = MAX_STAFF): string[] | undefined {
  const v = body[field]
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Invalid(field, 'must be a list of ids')
  if (v.length > max) throw new Invalid(field, `at most ${max}`)
  if (new Set(v).size !== v.length) throw new Invalid(field, 'the same id twice')
  const unknown = v.find((x) => !known.has(x))
  if (unknown) throw new Invalid(field, `unknown id ${unknown}`)
  return v as string[]
}

export function oneOf(body: Record<string, unknown>, field: string, known: Set<string>): string | undefined {
  const v = body[field]
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string' || !known.has(v)) throw new Invalid(field, `unknown id ${String(v)}`)
  return v
}

/** Staffing: one entry per person, `certificationIds` they must all hold (none = any worker). */
export function staffing(body: Record<string, unknown>, field: string, certs: Set<string>): { certificationIds?: string[] }[] | undefined {
  const v = body[field]
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v) || v.length > MAX_STAFF) throw new Invalid(field, `must be a list of at most ${MAX_STAFF} places`)
  return v.map((slot, i) => {
    if (!slot || typeof slot !== 'object') throw new Invalid(`${field}[${i}]`, 'must be an object')
    const ids = idList(slot as Record<string, unknown>, 'certificationIds', certs, 10) ?? []
    const real = ids.filter((id) => id !== GENERAL_CERT_ID)
    return real.length ? { certificationIds: real } : {}
  })
}

export function stars(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_STARS) throw new Invalid(field, `must be a whole number 0-${MAX_STARS}`)
  return v
}

/** Only these fields may be sent; anything else is refused so a typo is not silently ignored. */
export function onlyFields(body: Record<string, unknown>, allowed: string[]) {
  const extra = Object.keys(body).find((k) => !allowed.includes(k))
  if (extra) throw new Invalid(extra, `not a field here; allowed: ${allowed.join(', ')}`)
}
