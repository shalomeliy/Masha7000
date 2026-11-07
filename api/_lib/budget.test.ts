import { describe, expect, it } from 'vitest'
import { budgetLimit, costMicros, monthOf } from './budget.js'
import { assistantStream } from './assistant.js'

describe('assistant budget', () => {
  it('prices a Haiku answer by its tokens, cache included', () => {
    // 10,000 fresh in at $0.10/M = 1,000; 20,000 cache read at a tenth = 200; 4,000 cache write at 1.25x = 500; 1,000 out at $0.50/M = 500.
    expect(costMicros('claude-haiku-5-5', { input_tokens: 10_000, output_tokens: 1_000, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 4_000 })).toBe(2_200)
  })

  it('uses the long-prompt price above 100K tokens, and the higher price for an unknown model', () => {
    expect(costMicros('claude-haiku-5-5', { input_tokens: 120_000, output_tokens: 0 })).toBe(60_000)
    expect(costMicros('claude-something', { input_tokens: 1_000_000, output_tokens: 0 })).toBe(2_000_000)
  })

  it('counts by calendar month (UTC) and defaults to a $5 cap', () => {
    expect(monthOf(new Date('2026-11-30T23:59:00Z'))).toBe('2026-11')
    expect(budgetLimit({})).toBe(5)
    expect(budgetLimit({ ASSISTANT_BUDGET_USD: '12.5' })).toBe(12.5)
    expect(budgetLimit({ ASSISTANT_BUDGET_USD: 'abc' })).toBe(5)
  })

  it('puts what the after-step returns on the last line, also when the call is refused (no request on this machine)', async () => {
    const stream = assistantStream('sk-ant-fake', [{ role: 'user', content: 'x' }], {}, undefined, false, async () => ({ budget: { spentUsd: 1, limitUsd: 5, since: null } }))
    const last = JSON.parse((await new Response(stream).text()).trim().split('\n').pop()!) as Record<string, unknown>
    expect(last).toEqual({ reason: 'no-key', budget: { spentUsd: 1, limitUsd: 5, since: null } })
  })
})
