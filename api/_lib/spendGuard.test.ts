import { describe, expect, it } from 'vitest'
import { mockAssistantStream } from './assistantMock.js'
import { assertPaidCallAllowed, onVercel } from './spendGuard.js'
import { runAssistant } from './assistant.js'

async function lines(stream: ReadableStream<Uint8Array>) {
  const text = await new Response(stream).text()
  return text.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>)
}

describe('spend guard', () => {
  it('allows paid calls only on Vercel', () => {
    expect(onVercel({ VERCEL: '1' })).toBe(true)
    expect(onVercel({})).toBe(false)
    expect(() => assertPaidCallAllowed({})).toThrow(/blocked outside Vercel/)
    expect(() => assertPaidCallAllowed({ VERCEL: '1' })).not.toThrow()
  })

  it('stops the real assistant before any request on this machine, even with a key', async () => {
    const r = await runAssistant('sk-ant-fake', [{ role: 'user', content: 'שלום' }], { workers: [] })
    expect(r).toEqual({ ok: false, reason: 'no-key' })
  })
})

describe('mock assistant', () => {
  it('streams an early line and a spoken answer, like the real one', async () => {
    const [early, last] = await lines(mockAssistantStream([{ role: 'user', content: 'מי עובד מחר?' }]))
    expect(String(early.early)).toContain('מצב בדיקה')
    const reply = last.reply as { call: { name: string; input: { text: string } } }
    expect(reply.call.name).toBe('answer')
    expect(reply.call.input.text).toContain('מי עובד מחר?')
  })
})
