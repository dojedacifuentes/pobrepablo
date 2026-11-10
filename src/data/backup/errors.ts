export type BackupErrorCode =
  /** The file is not a NEXO backup at all. */
  | 'not_a_backup'
  /** It was written by a newer version of the app. */
  | 'unsupported_version'
  /** It is cut or damaged. */
  | 'corrupted'
  /** It is encrypted and no passphrase was given. */
  | 'passphrase_required'
  /** The passphrase is wrong, or the file was altered: the two cannot be told apart. */
  | 'wrong_passphrase'
  /** The passphrase chosen to export is too short or was not repeated the same. */
  | 'weak_passphrase'
  /** It is a backup, but its content breaks a rule. `problems` lists each one. */
  | 'invalid_content'
  /** It belongs to another profile, or mixes invented data with real data. */
  | 'wrong_profile'

/** Why a backup could not be written or read, in words for the person. */
export class BackupError extends Error {
  readonly code: BackupErrorCode
  readonly problems: readonly string[]

  constructor(code: BackupErrorCode, message: string, problems: readonly string[] = []) {
    super(message)
    this.name = 'BackupError'
    this.code = code
    this.problems = problems
  }
}
