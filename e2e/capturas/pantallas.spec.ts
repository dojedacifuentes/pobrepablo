import { type Page, type TestInfo, expect, test } from '@playwright/test'

/**
 * One picture of every screen, per viewport. Animations are frozen and the caret hidden, so that
 * two runs over the same data give the same picture.
 */
async function capture(page: Page, testInfo: TestInfo, screen: string, fullPage = false): Promise<void> {
  // Let the sheet finish rising and the fonts finish loading.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(450)
  // In a picture of the whole page the fixed bottom bar would land in the middle of the content.
  // By CSS and not by role: once hidden, the bar would no longer be found by its role.
  const nav = page.locator('nav[aria-label="Principal"]')
  if (fullPage && (await nav.count()) > 0) {
    await nav.evaluate((element) => (element.style.visibility = 'hidden'))
  }
  await page.screenshot({
    path: `capturas/${screen}/${testInfo.project.name}.png`,
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  })
  if (fullPage && (await nav.count()) > 0) {
    await nav.evaluate((element) => (element.style.visibility = ''))
  }
}

async function typeAmount(page: Page, digits: string): Promise<void> {
  const keypad = page.getByRole('group', { name: 'Teclado de montos' })
  for (const digit of digits) {
    await keypad.getByRole('button', { name: digit, exact: true }).click()
  }
}

const hero = (page: Page) => page.getByRole('region', { name: 'Disponible para gastar' })

test('perfil Demo', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'NEXO' })).toBeVisible()
  await capture(page, testInfo, '01-perfiles')

  await page.getByRole('button', { name: /Demo/ }).click()
  await expect(hero(page)).toBeVisible()
  await capture(page, testInfo, '02-inicio')
  await capture(page, testInfo, '03-inicio-completo', true)

  await page.getByRole('button', { name: '¿Cómo se calcula?' }).click()
  await expect(page.getByRole('dialog', { name: '¿Cómo se calcula?' })).toBeVisible()
  await capture(page, testInfo, '04-como-se-calcula')
  await page.getByRole('button', { name: 'Cerrar' }).click()

  await page.getByRole('button', { name: 'Añadir movimiento' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nuevo movimiento' })
  await expect(sheet).toBeVisible()
  await capture(page, testInfo, '05-registro-rapido')

  await typeAmount(page, '35990')
  await sheet.getByRole('button', { name: 'Supermercado' }).click()
  await capture(page, testInfo, '06-registro-rapido-listo')

  await sheet.getByRole('radio', { name: 'Transferencia' }).click()
  await capture(page, testInfo, '07-registro-transferencia')
  await sheet.getByRole('radio', { name: 'Gasto' }).click()
  await typeAmount(page, '1250')
  await sheet.getByRole('button', { name: 'Tres ceros' }).click()
  await sheet.getByRole('button', { name: 'Nota' }).click()
  await capture(page, testInfo, '08-registro-con-detalles')
  await page.getByRole('button', { name: 'Cerrar' }).click()

  await page.getByRole('link', { name: 'Movimientos' }).click()
  await expect(page.getByRole('button', { name: 'Mes anterior' })).toBeVisible()
  await capture(page, testInfo, '09-movimientos')

  await page.getByRole('link', { name: 'Metas' }).click()
  await capture(page, testInfo, '10-metas-sin-construir')

  await page.getByRole('link', { name: 'Inicio' }).click()
  await page.getByRole('button', { name: 'Ocultar montos' }).click()
  await expect(page.getByLabel('Monto oculto').first()).toBeVisible()
  await capture(page, testInfo, '11-montos-ocultos')
  await page.getByRole('button', { name: 'Mostrar montos' }).click()

  await page.getByRole('button', { name: /Cambiar de perfil/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await capture(page, testInfo, '12-perfil')
})

test('perfil nuevo: sin una sola cifra', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Diego/ }).click()
  await expect(page.getByText('Todavía no hay nada que contar.')).toBeVisible()
  await capture(page, testInfo, '13-inicio-vacio')

  await page.getByRole('button', { name: 'Crear mi primera cuenta' }).click()
  await expect(page.getByRole('dialog', { name: 'Nueva cuenta' })).toBeVisible()
  await capture(page, testInfo, '14-nueva-cuenta')
  // Nothing is saved: no picture may show an invented figure under a real person's profile.
})

test('montos grandes, siempre en la Demo', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Demo/ }).click()
  await expect(hero(page)).toBeVisible()

  // A deliberately huge income: the figure must never be cut, not even at 320 px.
  await page.getByRole('button', { name: 'Añadir movimiento' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nuevo movimiento' })
  await sheet.getByRole('radio', { name: 'Ingreso' }).click()
  await typeAmount(page, '987654321')
  await sheet.getByRole('button', { name: 'Sueldo' }).click()
  await sheet.getByRole('button', { name: 'Guardar' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'Ingreso registrado' })).toBeVisible()
  await capture(page, testInfo, '17-confirmacion-con-deshacer')

  await page.getByRole('button', { name: 'Añadir movimiento' }).click()
  await typeAmount(page, '123456789')
  await sheet.getByRole('button', { name: 'Tres ceros' }).click()
  await capture(page, testInfo, '16-registro-monto-grande')
  await page.getByRole('button', { name: 'Cerrar' }).click()

  // The notice goes away by itself; the big figure stays.
  await expect(page.getByRole('status').filter({ hasText: 'registrado' })).toBeHidden({ timeout: 10_000 })
  await expect(hero(page)).toContainText('$99')
  await capture(page, testInfo, '15-montos-grandes')
})
