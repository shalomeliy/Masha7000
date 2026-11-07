// The voice assistant's stand-in for local work: the same stream of JSON lines as assistantStream
// ({early}, then {reply}), with a fixed spoken answer, and no call to Anthropic at all. The dev
// server always uses it, so trying the assistant on this machine costs nothing.

const MOCK_TEXT = 'זה מצב בדיקה מקומי. העוזר האמיתי עובד רק באתר עצמו, כדי שבדיקות במחשב לא יעלו כסף.'

/** The last thing the manager said, for the echo in the mock answer. */
function lastSaid(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length === 0) return ''
  const content = (messages[messages.length - 1] as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((b) => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' ? [String((b as { text?: unknown }).text ?? '')] : [])).join(' ')
}

export function mockAssistantStream(messages: unknown): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const said = lastSaid(messages).trim()
  const text = said ? `${MOCK_TEXT} שמעתי: ${said.slice(0, 200)}` : MOCK_TEXT
  const call = { id: `mock_${Date.now()}`, name: 'answer', input: { text, openScreen: '', pressButton: '' } }
  return new ReadableStream({
    start(controller) {
      const line = (v: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(v)}\n`))
      line({ early: text })
      line({ reply: { content: [{ type: 'tool_use', ...call }], call, text: '' } })
      controller.close()
    },
  })
}
