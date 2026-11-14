import { expect, test } from '@playwright/test'

// A worker opening the constraints form from WhatsApp downloads the form only, never the manager's app.

test("the workers' form does not download the manager's app", async ({ page }) => {
  const loaded: string[] = []
  page.on('request', (r) => loaded.push(new URL(r.url()).pathname))
  await page.goto('/constraints/e2eTestCode123')
  await expect(page.locator('#root')).not.toBeEmpty()
  await page.waitForLoadState('networkidle')
  expect(loaded).toContain('/src/pages/ConstraintForm.tsx')
  for (const manager of ['/src/App.tsx', '/src/pages/Calendar.tsx', '/src/pages/Voice.tsx', '/src/pages/Settings.tsx']) expect(loaded).not.toContain(manager)
})
