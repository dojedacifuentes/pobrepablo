import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ITERATIONS,
  MAX_ITERATIONS,
  MIN_ITERATIONS,
  decryptBackup,
  encryptBackup,
  isEncryptedBackup,
  passphraseProblems,
} from './crypto'

const PHRASE = 'frase de prueba larga'
const TEXT = '{"dato":"un texto con eñes y $1.250.000"}'
/** The cheapest setting the format allows, to keep the tests quick. */
const QUICK = { iterations: MIN_ITERATIONS }

const failure = async (promise: Promise<unknown>): Promise<unknown> => promise.then(() => null, (error: unknown) => error)

describe('cifrado del respaldo', () => {
  it('ida y vuelta con las iteraciones por defecto (600.000)', async () => {
    const file = await encryptBackup(TEXT, PHRASE)
    expect(isEncryptedBackup(file)).toBe(true)
    expect(new DataView(file.buffer).getUint32(10, false)).toBe(DEFAULT_ITERATIONS)
    expect(await decryptBackup(file, PHRASE)).toBe(TEXT)
  })

  it('la cabecera es la del formato: NEXOBAK1, versión 1, algoritmo 1, sal de 16 e IV de 12', async () => {
    const file = await encryptBackup(TEXT, PHRASE, QUICK)
    expect(new TextDecoder().decode(file.slice(0, 8))).toBe('NEXOBAK1')
    expect(file[8]).toBe(1)
    expect(file[9]).toBe(1)
    expect(new DataView(file.buffer).getUint32(10, false)).toBe(MIN_ITERATIONS)
    // 42 bytes of header, the text, and the 16-byte authentication tag.
    expect(file.length).toBe(42 + new TextEncoder().encode(TEXT).length + 16)
  })

  it('nada del contenido se lee en el archivo cifrado', async () => {
    const file = await encryptBackup(TEXT, PHRASE, QUICK)
    const visible = new TextDecoder('latin1').decode(file)
    expect(visible).not.toContain('dato')
    expect(visible).not.toContain('1.250.000')
  })

  it('cada archivo usa una sal y un IV nuevos: dos cifrados del mismo texto son distintos', async () => {
    const first = await encryptBackup(TEXT, PHRASE, QUICK)
    const second = await encryptBackup(TEXT, PHRASE, QUICK)
    // The salt (16 bytes) and the IV (12 bytes), each on its own.
    expect([...first.slice(14, 30)]).not.toEqual([...second.slice(14, 30)])
    expect([...first.slice(30, 42)]).not.toEqual([...second.slice(30, 42)])
    expect(first.slice(14, 30).some((byte) => byte !== 0)).toBe(true)
    expect([...first.slice(42)]).not.toEqual([...second.slice(42)])
  })

  it('con otra frase no se abre', async () => {
    const file = await encryptBackup(TEXT, PHRASE, QUICK)
    expect(await failure(decryptBackup(file, 'otra frase distinta'))).toMatchObject({ code: 'wrong_passphrase' })
    expect(await failure(decryptBackup(file, `${PHRASE} `))).toMatchObject({ code: 'wrong_passphrase' })
  })

  it('un solo bit cambiado, en la cabecera o en el contenido, se detecta', async () => {
    const file = await encryptBackup(TEXT, PHRASE, QUICK)
    // Salt, IV, first byte of the ciphertext, last byte of the tag.
    for (const position of [14, 30, 42, file.length - 1]) {
      const altered = file.slice()
      altered[position] = (altered[position] ?? 0) ^ 1
      expect(await failure(decryptBackup(altered, PHRASE))).toMatchObject({ code: 'wrong_passphrase' })
    }
  })

  it('una cabecera manipulada se rechaza: otra versión, otro algoritmo, iteraciones fuera de rango', async () => {
    const file = await encryptBackup(TEXT, PHRASE, QUICK)
    const withByte = (position: number, value: number): Uint8Array => {
      const altered = file.slice()
      altered[position] = value
      return altered
    }
    const withIterations = (iterations: number): Uint8Array => {
      const altered = file.slice()
      new DataView(altered.buffer).setUint32(10, iterations, false)
      return altered
    }
    expect(await failure(decryptBackup(withByte(8, 2), PHRASE))).toMatchObject({ code: 'unsupported_version' })
    expect(await failure(decryptBackup(withByte(9, 2), PHRASE))).toMatchObject({ code: 'unsupported_version' })
    // A forged header must not be able to make the phone work for minutes.
    expect(await failure(decryptBackup(withIterations(MAX_ITERATIONS + 1), PHRASE))).toMatchObject({ code: 'corrupted' })
    expect(await failure(decryptBackup(withIterations(0xffffffff), PHRASE))).toMatchObject({ code: 'corrupted' })
    expect(await failure(decryptBackup(withIterations(1), PHRASE))).toMatchObject({ code: 'corrupted' })
    // Still within the limits but not the real figure: the key comes out different.
    expect(await failure(decryptBackup(withIterations(MIN_ITERATIONS + 1), PHRASE))).toMatchObject({
      code: 'wrong_passphrase',
    })
  })

  it('un archivo cortado o que no es un respaldo se rechaza con su motivo', async () => {
    const file = await encryptBackup(TEXT, PHRASE, QUICK)
    expect(await failure(decryptBackup(file.slice(0, 50), PHRASE))).toMatchObject({ code: 'corrupted' })
    expect(await failure(decryptBackup(file.slice(0, file.length - 5), PHRASE))).toMatchObject({
      code: 'wrong_passphrase',
    })
    expect(await failure(decryptBackup(new TextEncoder().encode('hola'), PHRASE))).toMatchObject({
      code: 'not_a_backup',
    })
    expect(isEncryptedBackup(new Uint8Array(3))).toBe(false)
  })

  it('la misma frase escrita con otra forma de los mismos caracteres abre el respaldo', async () => {
    // «é» as one character and as «e» plus a combining accent; a full-width «Ａ» and a plain «A».
    const file = await encryptBackup(TEXT, 'café Ａ para doce', QUICK)
    expect(await decryptBackup(file, 'café A para doce')).toBe(TEXT)
  })

  it('no cifra con menos iteraciones que el mínimo', async () => {
    await expect(encryptBackup(TEXT, PHRASE, { iterations: 1000 })).rejects.toThrow('fuera de rango')
  })
})

describe('frase para cifrar', () => {
  it('doce caracteres o más, y escrita dos veces igual', () => {
    expect(passphraseProblems('corta', 'corta')).toEqual(['La frase debe tener al menos 12 caracteres.'])
    expect(passphraseProblems('una frase bien larga', 'una frase bien largo')).toEqual(['Las dos frases no coinciden.'])
    expect(passphraseProblems('doce letras!', 'doce letras!')).toEqual([])
  })
})
