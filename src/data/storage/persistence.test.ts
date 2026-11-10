import { describe, expect, it } from 'vitest'
import { testPhone } from '../testing/harness'
import { requestPersistence, storageUsage } from './persistence'

describe('pedir al navegador que conserve los datos', () => {
  it('distingue los cuatro resultados', async () => {
    expect(await requestPersistence({ persist: () => Promise.resolve(true) })).toBe('persisted')
    expect(await requestPersistence({ persist: () => Promise.resolve(false) })).toBe('best_effort')
    expect(await requestPersistence(null)).toBe('unsupported')
    expect(await requestPersistence({})).toBe('unsupported')
    expect(await requestPersistence({ persist: () => Promise.reject(new Error('sin permiso')) })).toBe('failed')
  })

  it('si ya estaba concedido, no vuelve a preguntar', async () => {
    let asked = 0
    const state = await requestPersistence({
      persisted: () => Promise.resolve(true),
      persist: () => {
        asked += 1
        return Promise.resolve(false)
      },
    })
    expect(state).toBe('persisted')
    expect(asked).toBe(0)
  })

  it('en un entorno sin navigator.storage no falla', async () => {
    expect(await requestPersistence()).toMatch(/unsupported|persisted|best_effort|failed/)
  })

  it('el resultado queda guardado en el dispositivo, fuera de los respaldos', async () => {
    const phone = testPhone()
    const session = await phone.open('pablo')
    expect((await session.store.deviceState()).persistence).toBeNull()
    await session.store.notePersistence('best_effort')
    expect((await session.store.deviceState()).persistence).toMatchObject({ state: 'best_effort' })
    expect(JSON.stringify(await session.store.exportSnapshot())).not.toContain('best_effort')
  })
})

describe('espacio usado', () => {
  it('informa uso, cupo y porcentaje, y avisa cuando queda poco', async () => {
    expect(await storageUsage({ estimate: () => Promise.resolve({ usage: 250, quota: 1000 }) })).toEqual({
      usedBytes: 250,
      quotaBytes: 1000,
      percentUsed: 25,
      nearlyFull: false,
    })
    expect((await storageUsage({ estimate: () => Promise.resolve({ usage: 950, quota: 1000 }) })).nearlyFull).toBe(true)
  })

  it('si el navegador no lo informa, dice que no se sabe en vez de inventar', async () => {
    const unknown = { usedBytes: null, quotaBytes: null, percentUsed: null, nearlyFull: false }
    expect(await storageUsage(null)).toEqual(unknown)
    expect(await storageUsage({ estimate: () => Promise.reject(new Error('no')) })).toEqual(unknown)
    expect(await storageUsage({ estimate: () => Promise.resolve({}) })).toEqual(unknown)
    expect((await storageUsage({ estimate: () => Promise.resolve({ usage: 10, quota: 0 }) })).percentUsed).toBeNull()
  })
})
