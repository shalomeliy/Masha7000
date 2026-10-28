import type { ClosureOutcome } from '../../types/models'

// How each night-job outcome is named and colored, wherever it shows.
export const OUTCOMES: { id: ClosureOutcome; label: string; tone: string }[] = [
  { id: 'done', label: 'בוצע במלואו', tone: 'border-emerald-500 bg-emerald-500/15 text-emerald-200' },
  { id: 'partial', label: 'בוצע חלקית', tone: 'border-amber-500 bg-amber-500/15 text-amber-200' },
  { id: 'postponed', label: 'נדחה', tone: 'border-red-500 bg-red-500/15 text-red-200' },
]
