// Dates are stored as YYYY-MM-DD strings. A typed date must exist on the calendar
// (no 31.2) and fall inside the field's range.

export function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

const show = (v: string) => v.split('-').reverse().join('.')

// Hebrew error for the field, or null when the value is fine. Empty is fine unless required.
export function dateError(value: string, { min, max, required }: { min?: string; max?: string; required?: boolean } = {}): string | null {
  if (!value) return required ? 'צריך לבחור תאריך' : null
  if (!isRealDate(value)) return 'התאריך הזה לא קיים ביומן'
  if (min && value < min) return `התאריך צריך להיות מ-${show(min)} והלאה`
  if (max && value > max) return `התאריך צריך להיות עד ${show(max)}`
  return null
}

export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}
