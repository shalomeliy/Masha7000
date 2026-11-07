import { WORD_GROUPS } from './constraints'
import type { WordGroup, WordGroupSetting } from '../types/models'
import { tx } from '../i18n'

// The manager's own words for reading constraints. `readAnswer` reads the tables in constraints.ts;
// the manager's changes are applied to those same arrays in place, so every reader sees them
// without the word lists being passed through each call.

export const BUILT_IN: Record<WordGroup, readonly string[]> = Object.fromEntries(
  Object.entries(WORD_GROUPS).map(([k, words]) => [k, [...words]]),
) as Record<WordGroup, string[]>

export const GROUPS: { id: WordGroup; title: string; explain: string }[] = [
  { id: 'wholeDay', title: tx('כל היום'), explain: tx('מילים שאומרות שהעובד לא זמין כל היום, למשל לימודים, חופש.') },
  { id: 'events', title: tx('אירוע בערב'), explain: tx('אירועים שקורים בערב, למשל חתונה. אם כתוב גם בוקר או צהריים, זה מה שקובע.') },
  { id: 'morningEvents', title: tx('אירוע בבוקר'), explain: tx('אירועים שקורים בבוקר, למשל ברית.') },
  { id: 'cant', title: tx('לא יכול'), explain: tx('מילים כלליות של "לא יכול". נקרא ככל היום.') },
  { id: 'morning', title: tx('בוקר'), explain: tx('מילים שאומרות בוקר.') },
  { id: 'noon', title: tx('צהריים'), explain: tx('מילים שאומרות צהריים או אחר הצהריים.') },
  { id: 'evening', title: tx('ערב ולילה'), explain: tx('מילים שאומרות ערב. "לילה" לבד נקרא כ"בלי לילה".') },
]

const clean = (w: string) => w.replace(/\s+/g, ' ').trim()
const same = (a: string, b: string) => clean(a) === clean(b)

/** The words a group reads by: built-in ones not taken out, then the manager's own. */
export function groupWords(id: WordGroup, setting?: WordGroupSetting): string[] {
  const built = BUILT_IN[id].filter((w) => !setting?.removed.some((r) => same(r, w)))
  return [...built, ...(setting?.added ?? []).filter((a) => !built.some((w) => same(w, a)))]
}

/** A setting with one more word. A built-in word that was taken out comes back instead of being added twice. */
export function addWord(id: WordGroup, setting: WordGroupSetting | undefined, word: string): WordGroupSetting {
  const w = clean(word)
  const s = setting ?? { id, added: [], removed: [] }
  if (BUILT_IN[id].some((b) => same(b, w))) return { ...s, removed: s.removed.filter((r) => !same(r, w)) }
  return s.added.some((a) => same(a, w)) ? s : { ...s, added: [...s.added, w] }
}

export function removeWord(id: WordGroup, setting: WordGroupSetting | undefined, word: string): WordGroupSetting {
  const s = setting ?? { id, added: [], removed: [] }
  if (BUILT_IN[id].some((b) => same(b, word))) return s.removed.some((r) => same(r, word)) ? s : { ...s, removed: [...s.removed, word] }
  return { ...s, added: s.added.filter((a) => !same(a, word)) }
}

/** An error for a new word, or null. Words match inside longer words, so two letters would match almost anything. */
export function wordError(word: string, words: string[]): string | null {
  const w = clean(word)
  if (w.length < 2) return tx('צריך לפחות שתי אותיות')
  if (words.some((x) => same(x, w))) return tx('המילה כבר ברשימה')
  return null
}

/** Puts the manager's changes into the tables `readAnswer` reads. Safe to call again with the same settings. */
export function applyWordSettings(settings: WordGroupSetting[]) {
  for (const id of Object.keys(WORD_GROUPS) as WordGroup[]) {
    const table = WORD_GROUPS[id]
    table.splice(0, table.length, ...groupWords(id, settings.find((s) => s.id === id)))
  }
}
