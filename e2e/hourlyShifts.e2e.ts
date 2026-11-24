import { expect, test, type Page } from '@playwright/test'

// Smart onboarding stage 2 on the fake Drive: a new team picks shifts by hours in the wizard, its types get
// the hours, and a job in the calendar shows them. The owner's kind of team (data, no wizard) sees no switch.

const tab = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true })
const answer = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true }).click()

async function open(page: Page, empty: boolean) {
  await page.goto('/')
  await page.evaluate((e) => {
    sessionStorage.clear()
    localStorage.setItem('dev.mockDrive', '1')
    if (e) localStorage.setItem('dev.mockDrive.empty', '1')
    else localStorage.removeItem('dev.mockDrive.empty')
  }, empty)
  await page.reload()
}

async function templates(page: Page) {
  await tab(page, 'הגדרות').click()
  await page.getByRole('button', { name: /^עבודות ושיבוץ/ }).click()
  await page.getByRole('button', { name: /^תבניות עבודה/ }).click()
}

test('a new team picks shifts by hours, and its shift types carry the hours', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await open(page, true)
  await page.getByRole('button', { name: 'מתחילים' }).click()
  await answer(page, 'אבטחה ושמירה')
  await answer(page, 'עד 10')
  await answer(page, 'משמרות לפי שעות: בוקר, צהריים, ערב, לילה')
  await expect(page.getByRole('heading', { name: 'אילו משמרות, ובאיזה שעות?' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'לילה', exact: true }).check()
  await page.getByRole('button', { name: 'המשך' }).click()
  await answer(page, 'לא') // certs
  await answer(page, 'לא') // vehicles
  await answer(page, 'לא') // departments
  await answer(page, 'לא מוסרים')
  await answer(page, 'לא, אני מקליד')
  await answer(page, 'לא') // closing
  await answer(page, 'לא') // Shali
  await page.getByRole('button', { name: 'אין, המשך' }).click()
  await expect(page.getByRole('switch', { name: 'עבודות לילה' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'סיום, בוא נתחיל' }).click()

  await templates(page)
  await expect(page.getByRole('switch', { name: 'משמרות לפי שעות' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('07:00-15:00')).toBeVisible()
  await expect(page.getByText('15:00-23:00')).toBeVisible()
  await expect(page.getByText('23:00-07:00 למחרת')).toBeVisible()
  expect(errors).toEqual([])
})

test('a team from before the wizard sees no hours switch', async ({ page }) => {
  await open(page, false)
  await templates(page)
  await expect(page.getByText('נגמרת ב-16:00').first()).toBeVisible()
  await expect(page.getByRole('switch', { name: 'משמרות לפי שעות' })).toHaveCount(0)
})
