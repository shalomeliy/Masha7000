import type { ClosureOutcome } from '../../types/models'
import { tx } from '../../i18n'

// How each night-job outcome is named and colored, wherever it shows.
export const OUTCOMES: { id: ClosureOutcome; label: string; tone: string }[] = [
  { id: 'done', label: tx('בוצע במלואו'), tone: 'border-emerald-500 bg-emerald-500/15 text-emerald-200' },
  { id: 'partial', label: tx('בוצע חלקית'), tone: 'border-amber-500 bg-amber-500/15 text-amber-200' },
  { id: 'postponed', label: tx('נדחה'), tone: 'border-red-500 bg-red-500/15 text-red-200' },
]
