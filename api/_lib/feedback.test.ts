import { describe, expect, it, vi } from 'vitest'
import { FEEDBACK_MAX, FEEDBACK_TO_DEFAULT, faultDetails, faultMail, faultRecipient, faultWhatsapp, feedbackMail, feedbackText, sendFeedback } from './feedback.js'

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

describe('fault report mail', () => {
  it('goes to the dedicated address, else the feature-request one', () => {
    expect(faultRecipient({ FAULT_REPORT_EMAIL: ' faults@x.com ', FEEDBACK_TO: 'f@x.com' })).toBe('faults@x.com')
    expect(faultRecipient({ FEEDBACK_TO: 'f@x.com' })).toBe('f@x.com')
    expect(faultRecipient({})).toBe(FEEDBACK_TO_DEFAULT)
  })

  it('keeps the details short, on one line, and urgent only when true', () => {
    const d = faultDetails({ urgent: 'yes', where: 'יומן\nשורה', device: 'x'.repeat(500), page: 7 })
    expect(d.urgent).toBe(false)
    expect(d.where).toBe('יומן שורה')
    expect(d.device).toHaveLength(300)
    expect(d.page).toBe('')
    expect(faultDetails(null).urgent).toBe(false)
  })

  it('marks an urgent fault in the subject and lists the details as plain text', () => {
    const m = faultMail('השיבוץ לא נשמר\nפרטים', faultDetails({ urgent: true, where: 'יומן' }), 'boss@x.com', 'faults@x.com', 'from@x.com', new Date('2026-11-23T00:00:00Z'))
    expect(m.to).toEqual(['faults@x.com'])
    expect(m.reply_to).toBe('boss@x.com')
    expect(m.subject).toBe('Shali - תקלה דחופה: השיבוץ לא נשמר')
    expect(m.text).toContain('איפה באפליקציה: יומן')
    const full = faultMail('x', faultDetails({ model: 'Galaxy S23', os: 'Android', osVersion: '14', occurredAt: '24.11.2026 03:40' }), 'a@b.c', 't@x.com', 'f@x.com')
    expect(full.text).toContain('מכשיר: Galaxy S23')
    expect(full.text).toContain('מערכת הפעלה: Android 14')
    expect(full.text).toContain('מתי קרתה: 24.11.2026 03:40')
    expect(m.text).toContain('boss@x.com')
    expect(m).not.toHaveProperty('html')
  })
})

describe('urgent fault WhatsApp number', () => {
  it('keeps digits with the country code, and nothing when unset or broken', () => {
    expect(faultWhatsapp({ FAULT_WHATSAPP: '050-123-4567' })).toBe('972501234567')
    expect(faultWhatsapp({ FAULT_WHATSAPP: '+972 50 123 4567' })).toBe('972501234567')
    expect(faultWhatsapp({ FAULT_WHATSAPP: '12' })).toBe('')
    expect(faultWhatsapp({})).toBe('')
  })
})
