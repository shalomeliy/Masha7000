import { driveErrorText, isAuthExpired } from '../lib/data/errors'
import { useAuth } from '../store/auth'
import { tx } from '../i18n'

/** A failed Drive call, in plain words, with the one action that fixes it. */
export function DriveError({ error, action, onRetry }: { error: unknown; action: 'load' | 'save'; onRetry?: () => void }) {
  const { login, reconnect, who } = useAuth()
  const reason = isAuthExpired(error) ? error.reason : null
  // Only the owner can fix a broken Drive link; nobody here can fix being removed from the list.
  const fix =
    reason === 'owner-disconnected'
      ? who?.isOwner
        ? { label: tx('חיבור מחדש'), run: reconnect }
        : null
      : reason === 'not-allowed'
        ? null
        : reason
          ? { label: tx('התחברות מחדש'), run: login }
          : null

  return (
    <div role="alert" className="space-y-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
      <p>{driveErrorText(error, action)}</p>
      {(fix || (!reason && onRetry)) && (
        <button
          type="button"
          onClick={async () => {
            if (fix) await fix.run()
            onRetry?.()
          }}
          className="min-h-11 rounded-xl border border-red-400/50 px-4 font-semibold"
        >
          {fix ? fix.label : tx('נסה שוב')}
        </button>
      )}
    </div>
  )
}
