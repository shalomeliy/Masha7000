import { expect, test } from '@playwright/test'

// Smart onboarding part 2: a new customer whose Google sign-in was refused asks for access. The
// server is stood in by page.route (the dev server has none): it knows the email from the sign-in,
// so the form never asks for one and never sends one.

test('a refused sign-in can ask for access with a business name and WhatsApp, never typing an email', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const sent: unknown[] = []
  await page.route('**/api/token', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"reason":"no-session"}' }))
  await page.route('**/api/access', async (r) => {
    if (r.request().method() === 'POST') {
      sent.push(r.request().postDataJSON())
      return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
    }
    return r.fulfill({ contentType: 'application/json', body: '{"email":"new@example.com","sent":false}' })
  })
  await page.goto('/?signin=not-allowed')
  await expect(page.getByRole('heading', { name: 'לקוח חדש? בקש גישה' })).toBeVisible()
  await expect(page.getByText('new@example.com')).toBeVisible()
  const send = page.getByRole('button', { name: 'שליחת בקשה' })
  await page.getByLabel('שם העסק').fill('חשמל דרום')
  await page.getByLabel('וואטסאפ').fill('123')
  await expect(page.getByText('מספר וואטסאפ צריך להיות נייד, 05X.')).toBeVisible()
  await expect(send).toBeDisabled()
  await page.getByLabel('וואטסאפ').fill('050-1234567')
  await send.click()
  await expect(page.getByRole('status')).toContainText('הבקשה נשלחה')
  expect(sent).toEqual([{ businessName: 'חשמל דרום', whatsapp: '050-1234567' }])
  expect(errors).toEqual([])
})
