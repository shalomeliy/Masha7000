// Minimal typings for Google Identity Services (loaded from accounts.google.com/gsi/client).
declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    access_token: string
    expires_in: number
    scope: string
    error?: string
    error_description?: string
  }
  interface TokenClient {
    requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void
  }
  function initTokenClient(config: {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type: string; message?: string }) => void
  }): TokenClient
  function revoke(token: string, done?: () => void): void
}

interface Window {
  google?: { accounts?: { oauth2?: unknown } }
}
