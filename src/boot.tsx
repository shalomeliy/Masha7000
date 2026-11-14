import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { CrashGuard } from './components/CrashGuard'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

/** Draws one page of the app (src/entries/): the manager's app, or a workers' form. */
export function render(page: ReactNode, { installable }: { installable: boolean }) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <CrashGuard>{page}</CrashGuard>
      </QueryClientProvider>
    </StrictMode>,
  )

  // Installable app (PWA). Only in the built app: in dev the worker would cache Vite's live modules.
  if (import.meta.env.PROD && installable && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }
}
