import type { Worker } from '../types/models'
import { fullName, tagNames } from './catalog'
import { workerState } from './workerState'

interface Tag {
  id: string
  name: string
}

export interface SearchLists {
  certifications: Tag[]
  departments: Tag[]
}

const fold = (s: string) => s.toLocaleLowerCase().replace(/[֑-ׇ]/g, '').replace(/[״"'׳]/g, '')
const digits = (s: string) => s.replace(/\D/g, '')

/** "2001-03-04" also as "4.3.2001", the way people say a date here. */
const dateForms = (iso?: string) => {
  if (!iso) return []
  const [y, m, d] = iso.split('-').map(Number)
  return [iso, `${d}.${m}.${y}`, `${d}/${m}/${y}`]
}

/** Every word of a worker's card and form, in one string to search. */
function haystack(w: Worker, lists: SearchLists, today: string) {
  const numbers = [w.mobilePhone, w.homePhone, w.emergencyPhone1, w.emergencyPhone2, w.idNumber, w.personalNumber]
  const text = [
    fullName(w),
    `${w.lastName} ${w.firstName}`,
    ...numbers,
    w.address,
    w.notes,
    ...dateForms(w.birthDate),
    lists.departments.find((d) => d.id === w.departmentId)?.name,
    ...tagNames(w.certificationIds, lists.certifications),
    workerState(w, today).label,
  ]
  return { text: fold(text.filter(Boolean).join('\n')), numbers: numbers.map((n) => digits(n ?? '')).filter(Boolean) }
}

/**
 * Workers matching a free-text search: every word typed must appear somewhere in the worker's
 * details (name, phones, ID, personal number, department, certifications, state, notes...).
 * A number also matches a phone typed with or without dashes. Empty text = everyone.
 */
export function searchWorkers(workers: Worker[], query: string, lists: SearchLists, today: string): Worker[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return workers
  return workers.filter((w) => {
    const h = haystack(w, lists, today)
    return words.every((word) => {
      if (h.text.includes(word)) return true
      const n = digits(word)
      return n.length > 0 && n.length === word.replace(/[-\s]/g, '').length && h.numbers.some((x) => x.includes(n))
    })
  })
}
