import { driveErrorText, isAuthExpired } from '../lib/data/errors'
import { useAuth } from '../store/auth'

/** A failed Drive call, in plain words, with the one action that fixes it. */
export function DriveError({ error, action, onRetry }: { error: unknown; action: 'load' | 'save'; onRetry?: () => void }) {
  const login = useAuth((s) => s.login)
  const expired = isAuthExpired(error)

  return (
    <div role="alert" className="space-y-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
      <p>{driveErrorText(error, action)}</p>
      {(expired || onRetry) && (
        <button
          type="button"
          onClick={async () => {
            if (expired) await login()
            onRetry?.()
          }}
          className="min-h-11 rounded-xl border border-red-400/50 px-4 font-semibold"
        >
          {expired ? 'התחברות מחדש' : 'נסה שוב'}
        </button>
      )}
    </div>
  )
}
