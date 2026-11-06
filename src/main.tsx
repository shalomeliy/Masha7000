import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { joinCodeOf } from './lib/join'
import { JoinForm } from './pages/JoinForm'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

const joinCode = joinCodeOf(window.location.pathname)

// Local testing with a fake Drive (see src/dev/mockDrive.ts). Dropped from the build.
if (import.meta.env.DEV && localStorage.getItem('dev.mockDrive')) await import('./dev/mockDrive')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* A worker opening the details form from WhatsApp sees only the form, never the sign-in. */}
      {joinCode ? <JoinForm code={joinCode} /> : <App />}
    </QueryClientProvider>
  </StrictMode>,
)

// Installable app (PWA). Only in the built app: in dev the worker would cache Vite's live modules.
if (import.meta.env.PROD && !joinCode && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
