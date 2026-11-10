import { z } from 'zod'
import type { LedgerIssue, LocalDate } from '@/domain'
import type { Environment, Instant } from '../environment'
import type { ProfileStore } from '../ports'
import type { ProfileDescriptor } from '../profiles'
import { DATA_MODEL_VERSION, DATA_TABLES, type ProfileSnapshot, countUserRecords } from '../records'
import { describeIssues, instantSchema, profileSnapshotSchema } from '../schemas'
import { canonicalJson, sha256Hex } from './canonical'
import { decryptBackup, encryptBackup, isEncryptedBackup, passphraseProblems } from './crypto'
import { BackupError } from './errors'
import { checkSnapshot } from './integrity'

/**
 * A backup is one file with everything of one profile: every table and the audit trail, wrapped
 * in an envelope that says what it is, which version wrote it and a checksum of its content.
 * Encrypted or not, what is inside is the same JSON and it is read with the same validation.
 */

export const BACKUP_APP = 'nexo'
export const BACKUP_FORMAT = 'respaldo'
export const BACKUP_FORMAT_VERSION = 1

export interface BackupEnvelope {
  readonly app: typeof BACKUP_APP
  readonly format: typeof BACKUP_FORMAT
  readonly formatVersion: number
  /** The version of the shape of `data` (see `DATA_MODEL_VERSION`). */
  readonly schemaVersion: number
  readonly exportId: string
  readonly exportedAt: Instant
  readonly profile: { readonly id: string; readonly kind: string; readonly name: string }
  readonly counts: Readonly<Record<string, number>>
  /**
   * SHA-256 of the canonical text of `data`. It detects a damaged file. It is not a signature:
   * whoever edits an unencrypted backup on purpose can recompute it.
   */
  readonly checksum: string
  readonly data: unknown
}

const envelopeSchema = z.strictObject({
  app: z.literal(BACKUP_APP),
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.int().min(1),
  schemaVersion: z.int().min(1),
  exportId: z.string().min(1).max(120),
  exportedAt: instantSchema,
  profile: z.strictObject({ id: z.string(), kind: z.string(), name: z.string() }),
  counts: z.record(z.string(), z.int().min(0)),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  data: z.unknown(),
})

/**
 * How the data of an older version becomes the data of the next one: `1` turns version 1 into 2.
 * Empty for now. Every change of the database schema that alters a row adds its step here, with a
 * test that reads a backup of the previous version.
 */
export type BackupMigrations = Readonly<Record<number, (data: unknown) => unknown>>

export const BACKUP_MIGRATIONS: BackupMigrations = {}

/** Applies, in order, every step from version `from` up to version `to`. A missing step stops it. */
export function upgradeData(data: unknown, from: number, to: number, migrations: BackupMigrations): unknown {
  let current = data
  for (let version = from; version < to; version += 1) {
    const step = migrations[version]
    if (step === undefined) {
      throw new BackupError(
        'unsupported_version',
        'Este respaldo es de una versión antigua que esta app ya no sabe convertir.',
      )
    }
    current = step(current)
  }
  return current
}

// ── Opening a file ───────────────────────────────────────────────────────────────────────────

async function plainTextOf(file: Uint8Array, passphrase: string | undefined): Promise<string> {
  if (isEncryptedBackup(file)) {
    if (passphrase === undefined || passphrase.length === 0) {
      throw new BackupError('passphrase_required', 'Este respaldo está cifrado: escribe la frase con que se guardó.')
    }
    return decryptBackup(file, passphrase)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(file)
  } catch {
    throw new BackupError('not_a_backup', 'Este archivo no es un respaldo de NEXO.')
  }
}

interface OpenedBackup {
  readonly encrypted: boolean
  readonly envelope: z.output<typeof envelopeSchema>
}

/**
 * Opens the file and checks that it arrived whole: decrypted if needed, readable as JSON, with the
 * envelope of a NEXO backup, of a version this app understands, and with its content matching its
 * checksum. Says nothing yet about whether the content makes sense.
 */
async function openBackup(file: Uint8Array, passphrase: string | undefined): Promise<OpenedBackup> {
  const encrypted = isEncryptedBackup(file)
  const text = await plainTextOf(file, passphrase)
  // A NEXO backup always starts like this (the keys of the envelope are written in order). A file
  // that starts like one and cannot be read is a backup that was cut, not some other file.
  const looksLikeBackup = encrypted || text.trimStart().startsWith(`{"app":"${BACKUP_APP}"`)
  const damaged = (): BackupError =>
    new BackupError('corrupted', 'El respaldo está incompleto o dañado: el archivo se cortó o se alteró.')
  const foreign = (): BackupError => new BackupError('not_a_backup', 'Este archivo no es un respaldo de NEXO.')

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw looksLikeBackup ? damaged() : foreign()
  }
  const envelope = envelopeSchema.safeParse(json)
  if (!envelope.success) {
    const marked = typeof json === 'object' && json !== null && (json as { app?: unknown }).app === BACKUP_APP
    throw marked ? damaged() : foreign()
  }
  const { data, checksum, formatVersion, schemaVersion } = envelope.data
  if (formatVersion > BACKUP_FORMAT_VERSION || schemaVersion > DATA_MODEL_VERSION) {
    throw new BackupError(
      'unsupported_version',
      'Este respaldo lo guardó una versión más nueva de la app. Actualiza la app para restaurarlo.',
    )
  }
  if ((await sha256Hex(canonicalJson(data))) !== checksum) {
    throw new BackupError('corrupted', 'El respaldo está dañado o fue modificado: su contenido no coincide con su sello.')
  }
  return { encrypted, envelope: envelope.data }
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────

export interface ReadOptions {
  readonly passphrase?: string
  /**
   * Rescue only: accept a backup whose content breaks an accounting rule. The shape, the checksum
   * and the profile are still checked. For the day somebody's only backup is slightly wrong.
   */
  readonly acceptProblems?: boolean
}

export interface ReadBackup {
  readonly exportId: string
  readonly exportedAt: Instant
  readonly encrypted: boolean
  readonly snapshot: ProfileSnapshot
  /** Rules the content breaks. Empty unless `acceptProblems` let them through. */
  readonly problems: readonly string[]
  /** Household records without their counterpart. Never a reason to refuse; always shown. */
  readonly ledgerIssues: readonly LedgerIssue[]
}

/** Reads and checks a backup file without storing anything. */
export async function readBackup(file: Uint8Array, today: LocalDate, options: ReadOptions = {}): Promise<ReadBackup> {
  const { encrypted, envelope } = await openBackup(file, options.passphrase)
  const { data, schemaVersion, exportId, exportedAt, profile } = envelope

  const parsed = profileSnapshotSchema.safeParse(
    upgradeData(data, schemaVersion, DATA_MODEL_VERSION, BACKUP_MIGRATIONS),
  )
  if (!parsed.success) {
    throw new BackupError(
      'invalid_content',
      'El respaldo trae datos que la app no reconoce. No se importó nada.',
      describeIssues(parsed.error),
    )
  }
  const snapshot: ProfileSnapshot = parsed.data
  if (snapshot.meta.id !== profile.id || snapshot.meta.kind !== profile.kind) {
    throw new BackupError('corrupted', 'El respaldo se contradice sobre a quién pertenece.')
  }

  const report = checkSnapshot(snapshot, today)
  if (report.problems.length > 0 && options.acceptProblems !== true) {
    throw new BackupError(
      'invalid_content',
      'El respaldo trae datos que se contradicen. No se importó nada.',
      report.problems,
    )
  }
  return { exportId, exportedAt, encrypted, snapshot, problems: report.problems, ledgerIssues: report.ledgerIssues }
}

// ── Writing ──────────────────────────────────────────────────────────────────────────────────

/** A profile and where its data is kept. A `ProfileSession` is one. */
export interface BackupTarget {
  readonly profile: ProfileDescriptor
  readonly store: ProfileStore
  /** Called once a backup has been restored, so that a detected loss is no longer reported. */
  restored?(): void
}

export interface ExportOptions {
  /** With a passphrase the file is encrypted. Without one it is plain JSON: the interface warns. */
  readonly passphrase?: string
  /** The passphrase typed a second time. Checked only when given. */
  readonly repeatedPassphrase?: string
}

export interface BackupFile {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly fileName: string
  readonly mimeType: string
  readonly encrypted: boolean
  readonly exportId: string
  readonly exportedAt: Instant
  /** How many records of the person it contains. */
  readonly records: number
  /** The last entry of the audit trail the file holds. */
  readonly throughSeq: number
  /**
   * What is wrong with the stored data: a row the app would not accept back, or an accounting rule
   * that is broken. The file is written all the same, because the person's data is never withheld;
   * but a file with problems cannot be restored the normal way, and the interface must say so.
   */
  readonly problems: readonly string[]
}

/** What the data stored on this phone would be refused for, if it came in a file. */
function problemsOf(snapshot: ProfileSnapshot, today: LocalDate): string[] {
  const parsed = profileSnapshotSchema.safeParse(snapshot)
  if (!parsed.success) {
    return describeIssues(parsed.error)
  }
  return checkSnapshot(parsed.data, today).problems
}

/**
 * Writes a backup of the profile and proves that the file holds exactly what is stored before
 * handing it over: it is opened again (decrypted, if encrypted), its checksum is verified and its
 * content is compared with the database.
 *
 * `iterations` is for the tests only: it makes the encryption quicker, never weaker than the
 * minimum the format allows.
 */
export async function exportBackup(
  target: BackupTarget,
  env: Environment,
  options: ExportOptions = {},
  iterations?: number,
): Promise<BackupFile> {
  const { passphrase } = options
  if (passphrase !== undefined) {
    const weak = passphraseProblems(passphrase, options.repeatedPassphrase ?? passphrase)
    if (weak.length > 0) {
      throw new BackupError('weak_passphrase', 'La frase no sirve para cifrar el respaldo.', weak)
    }
  }

  const snapshot = await target.store.exportSnapshot()
  const exportedAt = env.now()
  const today = env.today()
  const envelope: BackupEnvelope = {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: DATA_MODEL_VERSION,
    exportId: env.newId(),
    exportedAt,
    profile: { id: snapshot.meta.id, kind: snapshot.meta.kind, name: snapshot.meta.name },
    counts: Object.fromEntries(
      [...DATA_TABLES, 'audit' as const].map((table) => [table, snapshot[table].length]),
    ),
    checksum: await sha256Hex(canonicalJson(snapshot)),
    data: snapshot,
  }
  const text = canonicalJson(envelope)
  const bytes =
    passphrase !== undefined
      ? await encryptBackup(text, passphrase, iterations !== undefined ? { iterations } : {})
      : new TextEncoder().encode(text)

  // The proof. A backup that cannot be opened is worse than none, because it is trusted.
  const proof = await openBackup(bytes, passphrase)
  if (canonicalJson(proof.envelope.data) !== canonicalJson(snapshot)) {
    throw new BackupError('corrupted', 'El respaldo recién escrito no coincide con los datos: no se entregó.')
  }

  return {
    bytes,
    fileName: `nexo-${snapshot.meta.id}-${today}.nexo.${passphrase !== undefined ? 'enc' : 'json'}`,
    mimeType: passphrase !== undefined ? 'application/octet-stream' : 'application/json',
    encrypted: passphrase !== undefined,
    exportId: envelope.exportId,
    exportedAt,
    records: countUserRecords(snapshot),
    throughSeq: snapshot.audit.at(-1)?.seq ?? 0,
    problems: problemsOf(snapshot, today),
  }
}

/**
 * To be called once the person really has the file outside the phone (saved, shared): from then
 * on, what the file holds counts as backed up. A file with problems does not count: it could not
 * be restored the normal way, so it must not silence the reminders.
 */
export async function noteBackupSaved(target: BackupTarget, file: BackupFile): Promise<boolean> {
  if (file.problems.length > 0) {
    return false
  }
  await target.store.noteBackupSaved(file.exportedAt, file.throughSeq)
  return true
}

export interface ImportResult {
  readonly exportId: string
  readonly exportedAt: Instant
  readonly records: number
  readonly problems: readonly string[]
  readonly ledgerIssues: readonly LedgerIssue[]
}

/**
 * Restores a backup: everything the profile holds is replaced by what the file holds, all or
 * nothing, and the audit trail gains one entry saying that this backup was restored. The
 * interface must warn before calling this on a profile that already has data.
 *
 * A backup only goes back into the profile it came from. In particular, the invented data of the
 * Demo can never land in a personal profile, nor real data in the Demo.
 */
export async function importBackup(
  target: BackupTarget,
  file: Uint8Array,
  env: Environment,
  options: ReadOptions = {},
): Promise<ImportResult> {
  const backup = await readBackup(file, env.today(), options)
  const { meta } = backup.snapshot
  if (meta.kind !== target.profile.kind) {
    throw new BackupError(
      'wrong_profile',
      target.profile.kind === 'demo'
        ? 'El perfil Demo solo acepta datos de demostración: este respaldo es de una persona.'
        : 'Este respaldo es de demostración: sus cifras son inventadas y no pueden entrar a un perfil real.',
    )
  }
  if (meta.id !== target.profile.id || meta.memberId !== target.profile.memberId) {
    throw new BackupError(
      'wrong_profile',
      `Este respaldo es del perfil de ${meta.name}: se restaura abriendo ese perfil, no el de ${target.profile.name}.`,
    )
  }

  const records = countUserRecords(backup.snapshot)
  await target.store.replaceWith(backup.snapshot, {
    at: env.now(),
    exportId: backup.exportId,
    exportedAt: backup.exportedAt,
    records,
  })
  target.restored?.()
  return {
    exportId: backup.exportId,
    exportedAt: backup.exportedAt,
    records,
    problems: backup.problems,
    ledgerIssues: backup.ledgerIssues,
  }
}
