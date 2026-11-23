// Claude Code PreToolUse hook (from "Claude Code in Action": hooks enforce rules the model may forget).
// The work folder on the owner's PC is shared by several Claude sessions at once, so a git command
// that touches everyone's files (add -A, stash, checkout, reset --hard, clean) can lose another
// session's work. This blocks those commands there. Cloud sessions have their own fresh clone
// (CLAUDE_CODE_REMOTE=true), so the guard stays out of their way.
import { pathToFileURL } from 'node:url'

const RULES = [
  [/\bgit\s+add\s+(-A\b|--all\b|\.(\s|$)|:\/)/, 'git add -A / git add . מוסיף גם קבצים של סשנים אחרים. הוסף רק את הקבצים שלך בשמם.'],
  [/\bgit\s+add\s+-[a-zA-Z]*u/, 'git add -u מוסיף גם קבצים של סשנים אחרים. הוסף רק את הקבצים שלך בשמם.'],
  [/\bgit\s+stash(?!\s+(list|show)\b)/, 'git stash לוקח גם את השינויים של סשנים אחרים.'],
  [/\bgit\s+(checkout|switch)\b/, 'git checkout / switch מחליף קבצים לכל הסשנים שעובדים בתיקייה.'],
  [/\bgit\s+restore\b(?!.*--staged)/, 'git restore מוחק שינויים שאולי שייכים לסשן אחר.'],
  [/\bgit\s+reset\b.*--(hard|merge|keep)\b/, 'git reset --hard מוחק שינויים של כל הסשנים.'],
  [/\bgit\s+clean\b/, 'git clean מוחק קבצים חדשים של סשנים אחרים.'],
]

/** Why the command is blocked, or null when it may run. */
export function blockReason(command, env = process.env) {
  if (env.CLAUDE_CODE_REMOTE === 'true' || typeof command !== 'string') return null
  for (const [re, why] of RULES) if (re.test(command)) return why
  return null
}

async function main() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  let command
  try {
    command = JSON.parse(raw)?.tool_input?.command
  } catch {
    return // unreadable input: never block by mistake
  }
  const why = blockReason(command)
  if (why) {
    process.stderr.write(`חסום: ${why} (כלל של הפרויקט: התיקייה משותפת לכמה סשנים)\n`)
    process.exit(2)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
