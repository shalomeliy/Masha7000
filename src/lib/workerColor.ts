import type { Worker } from '../types/models'

// Every worker gets a color of their own for the WhatsApp image, the same one every time.
// The color comes from the worker's id, so nothing is stored; when two ids land on the same color
// the later worker in the list moves on to the next free one. New workers are added at the end of
// the list, so adding one never changes anyone else's color.

/** Dark enough to read as bold text on the white shift card, and far apart from each other. */
export const WORKER_PALETTE = [
  '#b91c1c', // red
  '#1d4ed8', // blue
  '#15803d', // green
  '#7e22ce', // purple
  '#c2410c', // orange
  '#0f766e', // teal
  '#be185d', // pink
  '#854d0e', // brown
  '#4338ca', // indigo
  '#3f6212', // olive
  '#a21caf', // magenta
  '#155e75', // petrol
  '#065f46', // forest
  '#5b21b6', // violet
  '#b45309', // amber
]

/** For a worker that was deleted: plain dark text, like before colors. */
export const UNKNOWN_WORKER_COLOR = '#0f172a'

function hash(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Worker id -> color. Unique while there are no more workers than colors; after that colors repeat. */
export function workerColors(workers: Pick<Worker, 'id'>[]): Map<string, string> {
  const colors = new Map<string, string>()
  const used = new Set<number>()
  for (const w of workers) {
    let i = hash(w.id) % WORKER_PALETTE.length
    if (used.size < WORKER_PALETTE.length) while (used.has(i)) i = (i + 1) % WORKER_PALETTE.length
    used.add(i)
    colors.set(w.id, WORKER_PALETTE[i])
  }
  return colors
}
