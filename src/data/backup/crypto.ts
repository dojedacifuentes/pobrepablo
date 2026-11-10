import { BackupError } from './errors'

/**
 * The encrypted backup (ADR 0004): AES-256-GCM with a key derived from a passphrase by
 * PBKDF2-HMAC-SHA-256. Only Web Crypto, no dependencies.
 *
 * The file:
 *
 *   "NEXOBAK1" (8) · version (1) · algorithm (1) · iterations (4, big endian) · salt (16) · IV (12)
 *   followed by the ciphertext, which ends with the 16-byte authentication tag.
 *
 * The 42-byte header is authenticated as additional data: changing a single bit of it, or of the
 * ciphertext, makes the decryption fail. Nothing of the content is readable without the passphrase.
 *
 * The passphrase is never stored. If it is forgotten, the backup cannot be recovered by anybody.
 */

const MAGIC = 'NEXOBAK1'
const FORMAT_VERSION = 1
/** 1 = AES-256-GCM + PBKDF2-HMAC-SHA-256. The byte leaves room for Argon2id once it is native. */
const ALGORITHM = 1
const SALT_LENGTH = 16
const IV_LENGTH = 12
const TAG_LENGTH = 16
const HEADER_LENGTH = MAGIC.length + 1 + 1 + 4 + SALT_LENGTH + IV_LENGTH

/** OWASP's current figure for PBKDF2-HMAC-SHA-256. */
export const DEFAULT_ITERATIONS = 600_000
/** A header announcing fewer is refused: no file written by the app has less. */
export const MIN_ITERATIONS = 100_000
/** A header announcing more is refused: a forged file must not be able to freeze the phone. */
export const MAX_ITERATIONS = 5_000_000

export const MIN_PASSPHRASE_LENGTH = 12

export interface EncryptionOptions {
  /** Fewer than the default makes the tests quicker; never fewer than the minimum of the format. */
  readonly iterations?: number
}

/** The same phrase typed on two keyboards must give the same key: compatibility forms are unified. */
function normalizePassphrase(passphrase: string): string {
  return passphrase.normalize('NFKC')
}

/** What is wrong with a passphrase chosen to export. An empty list means it can be used. */
export function passphraseProblems(passphrase: string, repeated: string): string[] {
  const problems: string[] = []
  if ([...normalizePassphrase(passphrase)].length < MIN_PASSPHRASE_LENGTH) {
    problems.push(`La frase debe tener al menos ${String(MIN_PASSPHRASE_LENGTH)} caracteres.`)
  }
  if (normalizePassphrase(passphrase) !== normalizePassphrase(repeated)) {
    problems.push('Las dos frases no coinciden.')
  }
  return problems
}

/** A new salt and a new IV for every file. There is deliberately no way to supply them. */
function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length))
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizePassphrase(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function isEncryptedBackup(file: Uint8Array): boolean {
  if (file.length < MAGIC.length) {
    return false
  }
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (file[index] !== MAGIC.charCodeAt(index)) {
      return false
    }
  }
  return true
}

export async function encryptBackup(
  plainText: string,
  passphrase: string,
  options: EncryptionOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error(`Cantidad de iteraciones fuera de rango: ${String(iterations)}`)
  }
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)

  const header = new Uint8Array(HEADER_LENGTH)
  for (let index = 0; index < MAGIC.length; index += 1) {
    header[index] = MAGIC.charCodeAt(index)
  }
  const view = new DataView(header.buffer)
  view.setUint8(MAGIC.length, FORMAT_VERSION)
  view.setUint8(MAGIC.length + 1, ALGORITHM)
  view.setUint32(MAGIC.length + 2, iterations, false)
  header.set(salt, MAGIC.length + 6)
  header.set(iv, MAGIC.length + 6 + SALT_LENGTH)

  const key = await deriveKey(passphrase, salt, iterations)
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: header },
    key,
    new TextEncoder().encode(plainText),
  )

  const file = new Uint8Array(HEADER_LENGTH + cipher.byteLength)
  file.set(header, 0)
  file.set(new Uint8Array(cipher), HEADER_LENGTH)
  return file
}

export async function decryptBackup(file: Uint8Array, passphrase: string): Promise<string> {
  if (!isEncryptedBackup(file)) {
    throw new BackupError('not_a_backup', 'Este archivo no es un respaldo cifrado de NEXO.')
  }
  if (file.length < HEADER_LENGTH + TAG_LENGTH) {
    throw new BackupError('corrupted', 'El respaldo está incompleto: el archivo se cortó.')
  }
  // A private copy: the header and the ciphertext are read from bytes nobody else can change.
  const bytes = file.slice()
  const view = new DataView(bytes.buffer)
  const version = view.getUint8(MAGIC.length)
  const algorithm = view.getUint8(MAGIC.length + 1)
  const iterations = view.getUint32(MAGIC.length + 2, false)
  if (version !== FORMAT_VERSION || algorithm !== ALGORITHM) {
    throw new BackupError(
      'unsupported_version',
      'Este respaldo lo cifró una versión más nueva de la app. Actualiza la app para abrirlo.',
    )
  }
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new BackupError('corrupted', 'La cabecera del respaldo no es válida: el archivo está dañado.')
  }
  const header = bytes.slice(0, HEADER_LENGTH)
  const salt = bytes.slice(MAGIC.length + 6, MAGIC.length + 6 + SALT_LENGTH)
  const iv = bytes.slice(MAGIC.length + 6 + SALT_LENGTH, HEADER_LENGTH)
  const cipher = bytes.slice(HEADER_LENGTH)

  const key = await deriveKey(passphrase, salt, iterations)
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: header }, key, cipher)
  } catch {
    throw new BackupError(
      'wrong_passphrase',
      'No se pudo abrir el respaldo: la frase no es la correcta, o el archivo fue alterado.',
    )
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(plain)
}
