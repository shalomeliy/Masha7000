import { describe, expect, it, vi } from 'vitest'
import { FEEDBACK_MAX, feedbackMail, feedbackText, sendFeedback } from './feedback.js'

describe('feature request mail', () => {
  it('accepts trimmed text and refuses empty, non-text or too long', () => {
    expect(feedbackText('  כפתור חדש \r\n')).toBe('כפתור חדש')
    expect(feedbackText('   ')).toBeNull()
    expect(feedbackText(42)).toBeNull()
    expect(feedbackText('א'.repeat(FEEDBACK_MAX + 1))).toBeNull()
  })

  it('builds a plain text mail that names the sender and replies to them', () => {
    const m = feedbackMail('שורה ראשונה\nעוד', 'boss@x.com', 'to@x.com', 'from@x.com', new Date('2026-11-06T00:00:00Z'))
    expect(m.to).toEqual(['to@x.com'])
    expect(m.reply_to).toBe('boss@x.com')
    expect(m.subject).toContain('שורה ראשונה')
    expect(m.subject).not.toContain('עוד')
    expect(m.text).toContain('boss@x.com')
    expect(m).not.toHaveProperty('html')
  })

  it('posts to Resend with the key and reports refusal', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 422 }))
    const ok = await sendFeedback('k', feedbackMail('t', 'a@b.c', 'to@x.com', 'f@x.com'), fetcher as unknown as typeof fetch)
    expect(ok).toBe(false)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers.Authorization).toBe('Bearer k')
  })
})
