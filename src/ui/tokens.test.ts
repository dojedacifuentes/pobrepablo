import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COLORS, TEXT_PAIRS, contrast } from './tokens'

describe('paleta', () => {
  it('cada par de texto y fondo que usa la interfaz cumple WCAG AA', () => {
    for (const pair of TEXT_PAIRS) {
      const ratio = contrast(COLORS[pair.text], COLORS[pair.background])
      const needed = pair.large === true ? 3 : 4.5
      expect(ratio, `${pair.text} sobre ${pair.background}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(needed)
    }
  })

  it('el cálculo de contraste da los valores de referencia de WCAG', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrast('#FFFFFF', '#FFFFFF')).toBe(1)
    // #767676 on white is the classic «just passes AA» grey.
    expect(contrast('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2)
  })

  it('texto claro sobre los colores de acción no alcanza AA: por eso los botones llevan texto oscuro', () => {
    expect(contrast(COLORS.ink, COLORS.accent)).toBeLessThan(4.5)
    expect(contrast(COLORS.ink, COLORS.positive)).toBeLessThan(4.5)
  })

  it('los colores de la hoja de estilos son los mismos que los de la paleta', () => {
    const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8').toLowerCase()
    for (const [name, value] of Object.entries(COLORS)) {
      expect(css, `falta --color-${name}`).toContain(`--color-${name}: ${value.toLowerCase()};`)
    }
  })
})
