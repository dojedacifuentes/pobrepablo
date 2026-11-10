import { z } from 'zod'
import type { Instant } from '../environment'
import type { ProfileId } from '../records'

/**
 * Detecting lost data (ADR 0007).
 *
 * A browser can throw away a site's database. An emptied database looks exactly like a new
 * installation, and the worst answer to that is to greet the person with a blank app.
 *
 * So the app leaves a small note outside IndexedDB, in `localStorage`: how much the profile held
 * the last time something was stored. If the database comes back empty while the note says it
 * held something, the app says so and offers to restore a backup instead of starting over.
 *
 * The note holds two counts and a date. No amounts, no names: nothing financial.
 *
 * WHAT IT DOES NOT CATCH, and it is the main case on an iPhone: when Safari erases a site that is
 * not installed after seven days without use, it erases all the storage of the site, this note
 * included. Nothing a page can write survives that. The note catches a database that was lost
 * while `localStorage` was kept (a damaged database, a partial clean-up). The answers to the
 * seven-day eviction are others: installing the app, backing up often, and keeping «restore from
 * a backup» on the first screen.
 */

/** The little the marker needs from `localStorage`. */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** How much a profile holds. */
export interface ContentCount {
  /** Rows the person registered: accounts, movements, rules, goals… */
  readonly records: number
  /** Operations stored after the profile was prepared: also a setting or a category of their own. */
  readonly operations: number
}

export interface LossEvidence extends ContentCount {
  /** When that was last true. */
  readonly at: Instant
}

export interface LossMarker {
  read(): LossEvidence | null
  write(content: ContentCount, at: Instant): void
  clear(): void
}

const evidenceSchema = z.object({
  records: z.int().min(0),
  // Notes written before operations were counted have none: they count as zero.
  operations: z.int().min(0).default(0),
  at: z.string().min(1),
})

const NO_MARKER: LossMarker = { read: () => null, write: () => undefined, clear: () => undefined }

/** The browser's `localStorage`, or `null` where it does not exist or is blocked. */
export function browserStorage(): KeyValueStorage | null {
  try {
    const storage = (globalThis as { localStorage?: KeyValueStorage }).localStorage
    return storage ?? null
  } catch {
    return null
  }
}

/**
 * The marker of one profile. Reading and writing never throw: a browser that blocks `localStorage`
 * only loses the detection, never an operation.
 */
export function lossMarker(storage: KeyValueStorage | null, profileId: ProfileId): LossMarker {
  if (storage === null) {
    return NO_MARKER
  }
  const key = `nexo.marcador.${profileId}`
  return {
    read: () => {
      try {
        const text = storage.getItem(key)
        if (text === null) {
          return null
        }
        const parsed = evidenceSchema.safeParse(JSON.parse(text))
        return parsed.success ? parsed.data : null
      } catch {
        return null
      }
    },
    write: (content, at) => {
      try {
        storage.setItem(key, JSON.stringify({ records: content.records, operations: content.operations, at }))
      } catch {
        // Nothing to do: the detection is a safety net, not a requirement.
      }
    },
    clear: () => {
      try {
        storage.removeItem(key)
      } catch {
        // Same as above.
      }
    },
  }
}

/**
 * The database holds nothing although this device remembers that it held something: records the
 * person registered, or at least an operation of theirs (a setting, a category of their own).
 */
export function detectLoss(remembered: LossEvidence | null, now: ContentCount): LossEvidence | null {
  if (remembered === null) {
    return null
  }
  const recordsLost = remembered.records > 0 && now.records === 0
  const operationsLost = remembered.operations > 0 && now.operations === 0
  return recordsLost || operationsLost ? remembered : null
}
