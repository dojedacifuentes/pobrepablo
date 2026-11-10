import { expect, test } from '@playwright/test'

test('la app abre y no desborda horizontalmente', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'NEXO' })).toBeVisible()

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
