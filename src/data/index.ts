/**
 * The data layer of NEXO: everything stays on the device, in IndexedDB.
 *
 * This file is its only door. The screens import from `@/data` and nothing deeper: the Dexie
 * implementation behind it can be replaced (a future synchronisation layer) without touching
 * `domain/` or `features/`.
 */
export { type Environment, type Instant, systemEnvironment } from './environment'
export { DataError, type DataErrorCode } from './errors'
export { describeLedgerIssue } from './ledger-issues'
export * from './ports'
export { PROFILES, type ProfileDescriptor, profileDescriptor } from './profiles'
export * from './records'
export {
  type DataDependencies,
  type ProfileSession,
  deleteDemo,
  openProfile,
  resetDemo,
} from './session'

export { DEMO_MARK } from './demo/dataset'

export {
  type BackupFile,
  type BackupTarget,
  type ExportOptions,
  type ImportResult,
  type ReadBackup,
  type ReadOptions,
  exportBackup,
  importBackup,
  readBackup,
} from './backup/backup'
export { MIN_PASSPHRASE_LENGTH, isEncryptedBackup, passphraseProblems } from './backup/crypto'
export { BackupError, type BackupErrorCode } from './backup/errors'

export { type LossEvidence } from './storage/loss-marker'
export { type StorageUsage, requestPersistence, storageUsage } from './storage/persistence'

export * from './react'
