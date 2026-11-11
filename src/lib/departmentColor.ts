// Each department in its own color (the user's request, 2026-11-11): by its place in the manager's
// list, so the first ten never share one. Kept off green, red and orange, which the status uses.
const COLORS = [
  'text-sky-300',
  'text-violet-300',
  'text-pink-300',
  'text-cyan-300',
  'text-yellow-200',
  'text-fuchsia-300',
  'text-indigo-300',
  'text-teal-200',
  'text-lime-200',
  'text-blue-300',
] as const

/** The text color of a department; plain grey for none or one no longer in the list. */
export function departmentColor(id: string | undefined, departments: { id: string }[]): string {
  const i = id ? departments.findIndex((d) => d.id === id) : -1
  return i < 0 ? 'text-slate-200' : COLORS[i % COLORS.length]
}
