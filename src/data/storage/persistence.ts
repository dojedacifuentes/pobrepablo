import type { PersistenceState } from '../ports'

/**
 * Asking the browser to keep the data (`navigator.storage.persist()`).
 *
 * What each answer means, in the words the interface must use:
 *
 * - `persisted`: the browser will not delete the data on its own when the phone runs low on space.
 * - `best_effort`: the browser may delete the data if it needs the space. Back up often.
 * - `unsupported`: this browser cannot be asked. Assume the data may be deleted.
 * - `failed`: the question could not be asked. Same caution.
 *
 * None of the four is a backup. On an iPhone, a persisted answer is not known to stop Safari from
 * erasing a site that is not installed after seven days without use (ADR 0007).
 */

/** The part of `navigator.storage` that is used. Injected in tests. */
export interface StorageManagerLike {
  persist?: () => Promise<boolean>
  persisted?: () => Promise<boolean>
  estimate?: () => Promise<{ usage?: number; quota?: number }>
}

export function browserStorageManager(): StorageManagerLike | null {
  try {
    const manager = (globalThis as { navigator?: { storage?: StorageManagerLike } }).navigator?.storage
    return manager ?? null
  } catch {
    return null
  }
}

/** Must be called from a gesture of the person (a tap), after the first time they store something. */
export async function requestPersistence(
  manager: StorageManagerLike | null = browserStorageManager(),
): Promise<PersistenceState> {
  if (manager === null || typeof manager.persist !== 'function') {
    return 'unsupported'
  }
  try {
    if (typeof manager.persisted === 'function' && (await manager.persisted())) {
      return 'persisted'
    }
    return (await manager.persist()) ? 'persisted' : 'best_effort'
  } catch {
    return 'failed'
  }
}

export interface StorageUsage {
  readonly usedBytes: number | null
  readonly quotaBytes: number | null
  /** Whole percentage of the space the browser allows this site; `null` when unknown. */
  readonly percentUsed: number | null
  /** At 90 % or more: the next thing stored may be refused. */
  readonly nearlyFull: boolean
}

const NEARLY_FULL_PERCENT = 90

export async function storageUsage(
  manager: StorageManagerLike | null = browserStorageManager(),
): Promise<StorageUsage> {
  const unknown: StorageUsage = { usedBytes: null, quotaBytes: null, percentUsed: null, nearlyFull: false }
  if (manager === null || typeof manager.estimate !== 'function') {
    return unknown
  }
  try {
    const { usage, quota } = await manager.estimate()
    const usedBytes = typeof usage === 'number' ? usage : null
    const quotaBytes = typeof quota === 'number' && quota > 0 ? quota : null
    const percentUsed = usedBytes !== null && quotaBytes !== null ? Math.floor((usedBytes * 100) / quotaBytes) : null
    return { usedBytes, quotaBytes, percentUsed, nearlyFull: percentUsed !== null && percentUsed >= NEARLY_FULL_PERCENT }
  } catch {
    return unknown
  }
}
