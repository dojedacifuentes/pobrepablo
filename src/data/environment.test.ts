import { describe, expect, it } from 'vitest'
import { santiagoDayOf, systemEnvironment } from './environment'

describe('el día es el de Chile, no el de UTC', () => {
  it('a las 23:30 de Santiago en verano (UTC−3) todavía es el mismo día', () => {
    // 02:30 UTC of 11 November is 23:30 of 10 November in Santiago.
    expect(santiagoDayOf('2026-11-11T02:30:00.000Z')).toBe('2026-11-10')
    expect(santiagoDayOf('2026-11-11T03:00:00.000Z')).toBe('2026-11-11')
  })

  it('en invierno (UTC−4) el día cambia una hora después', () => {
    expect(santiagoDayOf('2026-07-01T03:30:00.000Z')).toBe('2026-06-30')
    expect(santiagoDayOf('2026-07-01T04:00:00.000Z')).toBe('2026-07-01')
  })

  it('el entorno real entrega un día válido, un instante y un identificador nuevo cada vez', () => {
    const env = systemEnvironment()
    expect(env.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const now = env.now()
    expect(new Date(now).toISOString()).toBe(now)
    expect(env.newId()).toMatch(/^[0-9a-f-]{36}$/)
    expect(env.newId()).not.toBe(env.newId())
  })
})
