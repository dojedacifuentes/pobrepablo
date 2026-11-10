import { buildDemoSnapshot } from './demo/dataset'
import { type IndexedDbDependencies, type NexoDatabase, openDatabase } from './dexie/database'
import { DexieProfileStore } from './dexie/store'
import { contentCount } from './dexie/snapshot'
import { type Environment, systemEnvironment } from './environment'
import { DataError, toDataError } from './errors'
import type { ProfileStore } from './ports'
import { type ProfileDescriptor, databaseName, profileDescriptor } from './profiles'
import type { ProfileId } from './records'
import { emptyProfile } from './seed'
import {
  type KeyValueStorage,
  type LossEvidence,
  type LossMarker,
  browserStorage,
  detectLoss,
  lossMarker,
} from './storage/loss-marker'

/** What the data layer takes from the outside. Everything has a browser default. */
export interface DataDependencies extends IndexedDbDependencies {
  readonly env?: Environment
  /** Where the data-loss marker is kept. `null` turns the detection off. */
  readonly markerStorage?: KeyValueStorage | null
}

/** One profile, opened on this device. */
export interface ProfileSession {
  readonly profile: ProfileDescriptor
  readonly store: ProfileStore
  /** True when this profile did not exist on this device until now. */
  readonly isNew: boolean
  /**
   * Not null when the database came back empty although this device remembers that it held
   * records. Nothing was prepared: the person either restores a backup or calls `startOver`.
   */
  readonly loss: LossEvidence | null
  /** «Empezar de cero»: accepts the loss and prepares an empty profile. */
  startOver(): Promise<void>
  /** A backup was restored: whatever loss had been detected is over. */
  restored(): void
  close(): void
}

class Session implements ProfileSession {
  loss: LossEvidence | null
  isNew: boolean

  constructor(
    readonly profile: ProfileDescriptor,
    readonly store: DexieProfileStore,
    private readonly db: NexoDatabase,
    private readonly env: Environment,
    private readonly marker: LossMarker,
    state: { loss: LossEvidence | null; isNew: boolean },
  ) {
    this.loss = state.loss
    this.isNew = state.isNew
  }

  async startOver(): Promise<void> {
    if ((await this.db.meta.get('profile')) === undefined) {
      await this.store.replaceWith(emptyProfile(this.profile, this.env.today(), this.env.now()))
    }
    this.marker.clear()
    this.loss = null
    this.isNew = true
  }

  restored(): void {
    this.loss = null
    this.isNew = false
  }

  close(): void {
    this.store.close()
  }
}

/**
 * Opens a profile. The first time, a personal profile is prepared empty (categories and household,
 * no figures) and the Demo is filled with its invented data. If the database is empty but should
 * not be, nothing is prepared and `loss` says what this device remembers.
 */
export async function openProfile(id: ProfileId, dependencies: DataDependencies = {}): Promise<ProfileSession> {
  const profile = profileDescriptor(id)
  const env = dependencies.env ?? systemEnvironment()
  const storage = dependencies.markerStorage === undefined ? browserStorage() : dependencies.markerStorage
  // The Demo needs no marker: its data can always be generated again.
  const marker = lossMarker(profile.kind === 'demo' ? null : storage, id)
  const db = await openDatabase(databaseName(id), dependencies)
  const store = new DexieProfileStore(db, env, profile, {
    // Erasing on purpose is not a loss: the note is thrown away with the data.
    onContentChanged: (content) => (content === null ? marker.clear() : marker.write(content, env.now())),
  })

  try {
    const meta = await db.meta.get('profile')
    if (meta !== undefined && (meta.id !== profile.id || meta.kind !== profile.kind)) {
      throw new DataError('conflict', `La base de ${profile.name} contiene los datos de otro perfil. No se abrió.`)
    }
    const prepared = meta !== undefined
    const loss = detectLoss(marker.read(), await contentCount(db))
    let isNew = false
    if (loss === null && !prepared) {
      await store.replaceWith(
        profile.kind === 'demo'
          ? buildDemoSnapshot(profile, env.today(), env.now())
          : emptyProfile(profile, env.today(), env.now()),
      )
      isNew = true
    }
    return new Session(profile, store, db, env, marker, { loss, isNew })
  } catch (error) {
    db.close()
    throw toDataError(error)
  }
}

/** Puts the Demo back as it was the first day. The two personal profiles are not touched. */
export async function resetDemo(session: ProfileSession, env: Environment = systemEnvironment()): Promise<void> {
  if (session.profile.kind !== 'demo') {
    throw new DataError('conflict', 'Solo el perfil Demo se puede reiniciar.')
  }
  await session.store.replaceWith(buildDemoSnapshot(session.profile, env.today(), env.now()))
}

/** Deletes the Demo database completely. Opening the Demo again creates it anew. */
export async function deleteDemo(dependencies: IndexedDbDependencies = {}): Promise<void> {
  const db = await openDatabase(databaseName('demo'), dependencies)
  try {
    await db.delete()
  } catch (error) {
    throw toDataError(error)
  }
}
