import type Anthropic from '@anthropic-ai/sdk'
import type { Env } from './env.js'
import { kv } from './kv.js'

// How much of the month's Anthropic budget the voice assistant has used (the user's request,
// 2026-11-07: show what is left on Shali's screen). A regular API key cannot read the account's
// balance, so the server counts it itself: after every paid answer, the tokens it used times the
// model's price, added up per calendar month (UTC, like Anthropic's monthly limit). It only sees
// what this app spent since counting started; the Console's number is the exact one.

/** Dollars per million tokens, up to and above a 100K-token prompt (claude-api skill, cached 2026-10-06). */
const PRICES: Record<string, { in: number; out: number; inLong?: number; outLong?: number }> = {
  'claude-haiku-5-5': { in: 0.1, out: 0.5, inLong: 0.5, outLong: 2.5 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
}
const LONG_PROMPT = 100_000
const CACHE_WRITE = 1.25 // 5-minute cache write, times the input price
const CACHE_READ = 0.1

/** The monthly cap in dollars: Vercel env ASSISTANT_BUDGET_USD, else 5 (the account's limit). */
export function budgetLimit(e: NodeJS.ProcessEnv = process.env): number {
  const n = Number((e.ASSISTANT_BUDGET_USD ?? '').trim())
  return Number.isFinite(n) && n > 0 ? n : 5
}

type Usage = Pick<Anthropic.Usage, 'input_tokens' | 'output_tokens'> & {
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/** One answer's cost in millionths of a dollar (whole numbers add up exactly in the store). */
export function costMicros(model: string, usage: Usage): number {
  const p = PRICES[model] ?? PRICES['claude-sonnet-5-5'] // an unknown model is counted at the higher price
  const write = usage.cache_creation_input_tokens ?? 0
  const read = usage.cache_read_input_tokens ?? 0
  const long = usage.input_tokens + write + read > LONG_PROMPT
  const pin = long && p.inLong ? p.inLong : p.in
  const pout = long && p.outLong ? p.outLong : p.out
  // Price per million tokens = millionths of a dollar per token.
  return Math.ceil(usage.input_tokens * pin + write * pin * CACHE_WRITE + read * pin * CACHE_READ + usage.output_tokens * pout)
}

export const monthOf = (now: Date) => now.toISOString().slice(0, 7)
const spendKey = (month: string) => `spend:${month}`
const sinceKey = (month: string) => `spend-since:${month}`
const KEEP = 70 * 86_400 // a month's counter is kept a little past the month

export interface Budget {
  spentUsd: number
  limitUsd: number
  /** The first day counted this month (YYYY-MM-DD): earlier spending this month is not known. */
  since: string | null
}

/** Adds one answer's cost to this month. Never throws: a failed count must not lose the answer. */
export async function recordSpend(env: Env, model: string, usage: Usage | undefined, now = new Date()): Promise<void> {
  if (!usage) return
  const month = monthOf(now)
  try {
    await kv.setNew(env, sinceKey(month), now.toISOString().slice(0, 10), KEEP)
    await kv.incrBy(env, spendKey(month), costMicros(model, usage))
    await kv.expire(env, spendKey(month), KEEP)
  } catch (e) {
    console.error('budget count failed', (e as Error).message?.slice(0, 200))
  }
}

export async function readBudget(env: Env, now = new Date(), e: NodeJS.ProcessEnv = process.env): Promise<Budget> {
  const month = monthOf(now)
  const [spent, since] = await Promise.all([kv.get(env, spendKey(month)), kv.get(env, sinceKey(month))])
  return { spentUsd: Number(spent ?? 0) / 1_000_000, limitUsd: budgetLimit(e), since: since ?? null }
}
