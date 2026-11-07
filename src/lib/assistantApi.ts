import { language, tx } from '../i18n'
import { realAssistantOn } from '../dev/realAssistant'
// Talking to /api/assistant. The conversation is kept here in the shape the Claude API wants
// (user and assistant turns in order, the assistant's blocks sent back unchanged), and is sent
// whole each turn: the server keeps nothing.

export interface ToolCall {
  id: string
  name: 'ask_user' | 'answer' | 'propose' | string
  input: Record<string, unknown>
}

type Block = Record<string, unknown>
export type Turn = { role: 'user'; content: string | Block[] } | { role: 'assistant'; content: Block[] }

export interface AssistantAnswer {
  content: Block[]
  call: ToolCall | null
  text: string
}

const REASONS: Record<string, string> = {
  'not-owner': tx('העוזר הקולי פתוח רק לחשבון של המנהל.'),
  'no-session': tx('החיבור במכשיר הזה נגמר. צריך להתחבר שוב.'),
  'mfa-required': tx('צריך להתחבר שוב עם הקוד מאפליקציית האימות.'),
  'no-key': tx('העוזר הקולי עוד לא מחובר. צריך להוסיף את מפתח Anthropic בהגדרות של Vercel.'),
  'no-credit': tx('נגמר התקציב של Anthropic לחודש הזה, אז העוזר לא יכול לענות. אפשר להוסיף קרדיט ב-console.anthropic.com. פקודות פשוטות עדיין עובדות בחינם.'),
  'not-configured': tx('העוזר הקולי עובד רק באתר עצמו, לא בגרסה המקומית.'),
  'too-many': tx('יותר מדי בקשות בזמן קצר. נסה שוב בעוד כמה דקות.'),
  refused: tx('העוזר לא יכול לענות על זה. נסה לנסח אחרת.'),
}

/** The next user turn: plain words, or, after a tool call, its result followed by the words. */
export function userTurn(last: AssistantAnswer | null, said: string, result = 'המנהל ענה בהודעה הבאה.', isError = false): Turn {
  if (!last?.call) return { role: 'user', content: said }
  const blocks: Block[] = [{ type: 'tool_result', tool_use_id: last.call.id, content: result, ...(isError ? { is_error: true } : {}) }]
  if (said) blocks.push({ type: 'text', text: said })
  return { role: 'user', content: blocks }
}

/**
 * One turn. The server streams JSON lines: `{early}` (the spoken part, as soon as it is written:
 * `onEarly` gets it), then `{reply}` or `{reason}`.
 */
export async function askAssistant(messages: Turn[], context: unknown, onEarly?: (text: string) => void): Promise<AssistantAnswer> {
  let res: Response
  try {
    res = await fetch('/api/assistant', {
      method: 'POST',
      credentials: 'same-origin',
      // Dev server only: the owner's switch for a real answer (src/dev/realAssistant.ts); else a stand-in.
      headers: { 'Content-Type': 'application/json', ...(import.meta.env.DEV && realAssistantOn() ? { 'X-Dev-Real-Assistant': '1' } : {}) },
      // The language the assistant speaks in: the app's (Settings).
      body: JSON.stringify({ messages, context: { ...(context as object), replyLanguage: language().english } }),
    })
  } catch {
    throw new Error(tx('אין חיבור לאינטרנט.'))
  }
  if (res.status === 404) throw new Error(REASONS['not-configured'])
  const failed = (reason?: string) => new Error(REASONS[reason ?? ''] ?? tx('העוזר לא הצליח לענות. נסה שוב.'))
  if (!res.ok || !res.body || !(res.headers.get('content-type') ?? '').includes('ndjson')) {
    const data = (await res.json().catch(() => ({}))) as { reason?: string }
    throw failed(data.reason)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }))
    if (value) buffer += value
    const lines = buffer.split('\n')
    buffer = done ? '' : lines.pop()!
    for (const line of lines.filter(Boolean)) {
      const msg = JSON.parse(line) as { early?: string; reply?: Partial<AssistantAnswer>; reason?: string }
      if (msg.early) onEarly?.(msg.early)
      if (msg.reason) throw failed(msg.reason)
      if (msg.reply) return { content: msg.reply.content ?? [], call: msg.reply.call ?? null, text: msg.reply.text ?? '' }
    }
    if (done) throw failed()
  }
}
