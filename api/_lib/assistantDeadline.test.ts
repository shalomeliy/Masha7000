import { afterEach, describe, expect, it, vi } from 'vitest'

// A stand-in for the Anthropic SDK: nothing leaves this machine. Its stream never answers, it only
// waits until the abort signal it was given fires, like a very slow real answer.
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class Anthropic {
    static APIError = APIError
    static AuthenticationError = AuthenticationError
    static PermissionDeniedError = PermissionDeniedError
    messages = {
      stream: (_body: unknown, opts: { signal: AbortSignal }) => {
        const stopped = new Promise<never>((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted'))))
        return {
          [Symbol.asyncIterator]: () => ({ next: () => stopped }),
          finalMessage: () => stopped,
        }
      },
    }
  }
  return { default: Anthropic }
})

const { ASSISTANT_DEADLINE_MS, runAssistant } = await import('./assistant.js')

describe('assistant deadline', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('ends well before Vercel stops the function at 60 s', () => {
    expect(ASSISTANT_DEADLINE_MS).toBeLessThanOrEqual(50_000)
  })

  it('a slow answer ends with reason "timeout" at the deadline, not by being cut off', async () => {
    vi.useFakeTimers()
    vi.stubEnv('VERCEL', '1')
    const turn = runAssistant('fake-key', [{ role: 'user', content: 'שלום' }], { workers: [] })
    await vi.advanceTimersByTimeAsync(ASSISTANT_DEADLINE_MS)
    await expect(turn).resolves.toEqual({ ok: false, reason: 'timeout' })
  })
})
