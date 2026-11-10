import { type Page, expect, test } from '@playwright/test'

/** No screen may ever scroll sideways. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

async function typeAmount(page: Page, digits: string): Promise<void> {
  const keypad = page.getByRole('group', { name: 'Teclado de montos' })
  for (const digit of digits) {
    await keypad.getByRole('button', { name: digit, exact: true }).click()
  }
}

const hero = (page: Page) => page.getByRole('region', { name: 'Disponible para gastar' })

/** Opens Pablo's profile, brand new, and gives it one account with $500.000. */
async function startWithOneAccount(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: /Pablo/ }).click()
  await expect(page.getByText('Todavía no hay nada que contar.')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: 'Crear mi primera cuenta' }).click()
  await page.getByLabel('Cuánto tiene hoy').fill('500.000')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await expect(hero(page)).toContainText('$500.000')
}

test('abrir → registrar un gasto → saldo y lista actualizados → recargar → los datos siguen ahí', async ({ page }) => {
  await startWithOneAccount(page)
  await expect(page.getByText('Aún no registras movimientos.')).toBeVisible()

  // The quick add: the amount first, then one tap for the category and one to save.
  await page.getByRole('button', { name: 'Añadir movimiento' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nuevo movimiento' })
  await expect(sheet).toBeVisible()
  // The button says what is still missing, instead of just being greyed out.
  await expect(sheet.getByRole('button', { name: 'Escribe el monto' })).toBeDisabled()

  await typeAmount(page, '35990')
  await expect(sheet.getByLabel('Monto', { exact: true })).toHaveText('$35.990')
  await expect(sheet.getByRole('button', { name: 'Elige una categoría' })).toBeDisabled()
  await sheet.getByRole('button', { name: 'Supermercado' }).click()
  const save = sheet.getByRole('button', { name: 'Guardar' })
  await expect(save).toBeEnabled()
  // The whole form, keypad and save button included, is on screen without scrolling.
  await expect(save).toBeInViewport({ ratio: 1 })
  await expect(sheet.getByRole('button', { name: 'Tres ceros' })).toBeInViewport({ ratio: 1 })
  await expectNoHorizontalOverflow(page)
  await save.click()

  await expect(sheet).toBeHidden()
  await expect(page.getByRole('status')).toContainText('Gasto registrado')
  await expect(page.getByRole('status')).toContainText('$35.990')
  await expect(hero(page)).toContainText('$464.010')
  const recent = page.getByRole('region', { name: 'Últimos movimientos' }).or(page.locator('section', { hasText: 'Últimos movimientos' }))
  await expect(recent.getByText('Supermercado')).toBeVisible()
  await expect(recent.getByText('−$35.990')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  // The same data in «Movimientos».
  await page.getByRole('link', { name: 'Movimientos' }).click()
  await expect(page.getByRole('heading', { name: 'Hoy' })).toBeVisible()
  await expect(page.getByText('−$35.990')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  // Reload: the profile is remembered and everything is still there.
  await page.reload()
  await expect(page.getByText('−$35.990')).toBeVisible()
  await page.getByRole('link', { name: 'Inicio' }).click()
  await expect(hero(page)).toContainText('$464.010')
  await expect(page.getByText('Supermercado')).toBeVisible()
})

test('deshacer anula el movimiento y el saldo vuelve a ser el de antes', async ({ page }) => {
  await startWithOneAccount(page)

  await page.getByRole('button', { name: 'Añadir movimiento' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nuevo movimiento' })
  await typeAmount(page, '12000')
  await sheet.getByRole('button', { name: 'Transporte' }).click()
  await sheet.getByRole('button', { name: 'Guardar' }).click()
  await expect(hero(page)).toContainText('$488.000')

  await page.getByRole('status').getByRole('button', { name: 'Deshacer' }).click()
  await expect(hero(page)).toContainText('$500.000')
  await expect(page.getByRole('status')).toContainText('Movimiento anulado')

  // The voided movement did not disappear: it stays in the history, crossed out.
  await page.getByRole('link', { name: 'Movimientos' }).click()
  await expect(page.getByText(/Anulado/)).toBeVisible()
})

test('un doble toque en «Guardar» registra una sola vez', async ({ page }) => {
  await startWithOneAccount(page)

  await page.getByRole('button', { name: 'Añadir movimiento' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nuevo movimiento' })
  await typeAmount(page, '9000')
  await sheet.getByRole('button', { name: 'Ocio' }).click()
  await sheet.getByRole('button', { name: 'Guardar' }).dblclick()

  await expect(hero(page)).toContainText('$491.000')
  await page.getByRole('link', { name: 'Movimientos' }).click()
  await expect(page.getByText('−$9.000')).toHaveCount(1)
})

test('un ingreso sube el saldo y «¿cómo se calcula?» explica la cifra paso a paso', async ({ page }) => {
  await startWithOneAccount(page)

  await page.getByRole('button', { name: 'Añadir movimiento' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nuevo movimiento' })
  await sheet.getByRole('radio', { name: 'Ingreso' }).click()
  await typeAmount(page, '1250')
  await sheet.getByRole('button', { name: 'Tres ceros' }).click()
  await expect(sheet.getByLabel('Monto', { exact: true })).toHaveText('$1.250.000')
  await sheet.getByRole('button', { name: 'Sueldo' }).click()
  await sheet.getByRole('button', { name: 'Guardar' }).click()
  await expect(hero(page)).toContainText('$1.750.000')

  await page.getByRole('button', { name: '¿Cómo se calcula?' }).click()
  const explanation = page.getByRole('dialog', { name: '¿Cómo se calcula?' })
  await expect(explanation.getByText('Lo que tienes hoy')).toBeVisible()
  await expect(explanation.getByText('$1.750.000')).toHaveCount(2)
  await expectNoHorizontalOverflow(page)
})

test('la Demo abre con datos marcados como inventados y no toca el perfil de Pablo', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Demo/ }).click()
  await expect(page.getByText('Demo · todas las cifras son inventadas')).toBeVisible()
  await expect(hero(page)).toBeVisible()
  await expect(page.getByText('Próximos compromisos')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: /Cambiar de perfil/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cambiar de perfil' }).click()
  await page.getByRole('button', { name: /Pablo/ }).click()
  await expect(page.getByText('Todavía no hay nada que contar.')).toBeVisible()
})

test('un aviso que sigue en pantalla no tapa el teclado de la hoja siguiente', async ({ page }) => {
  await startWithOneAccount(page)
  // The «Cuenta creada» notice is still showing: the sheet opens over it, not under it.
  await expect(page.getByRole('status')).toContainText('Cuenta creada')
  await page.getByRole('button', { name: 'Añadir movimiento' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nuevo movimiento' })
  const keypad = sheet.getByRole('group', { name: 'Teclado de montos' })
  // The bottom row of the keypad and «Guardar» are where the notice used to sit.
  for (const key of ['Tres ceros', '0', 'Borrar']) {
    await keypad.getByRole('button', { name: key, exact: true }).click({ trial: true, timeout: 1500 })
  }
  await keypad.getByRole('button', { name: '7', exact: true }).click({ timeout: 1500 })
  await keypad.getByRole('button', { name: '0', exact: true }).click({ timeout: 1500 })
  await sheet.getByRole('button', { name: 'Ocio' }).click({ timeout: 1500 })
  await sheet.getByRole('button', { name: 'Guardar' }).click({ timeout: 1500 })
  await expect(hero(page)).toContainText('$499.930')
})
