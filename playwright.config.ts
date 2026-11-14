import { defineConfig, devices } from '@playwright/test'

// Whole-app checks in a real browser (npm run e2e): the dev server with the fake Drive
// (src/dev/mockDrive.ts), so nothing touches Google, and the assistant answers from its stand-in
// (never Anthropic). Not part of `npm run verify`; CI runs it as its own job.
const PORT = 5181

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, ...devices['Pixel 7'], trace: 'off' },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // Any id will do: the fake Drive signs in without Google.
    env: { VITE_GOOGLE_CLIENT_ID: 'e2e.apps.googleusercontent.com' },
  },
})
