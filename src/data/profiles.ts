import { type MemberId, toId } from '@/domain'
import type { Member, ProfileId, ProfileKind } from './records'

/**
 * The three profiles of the app. Each one has its own database, so nothing of one can show up in
 * another, and the Demo can be reset or deleted without touching the two real ones.
 *
 * The profiles are not protected from each other: anybody holding the phone can open any of them.
 * The interface must say so.
 */
export interface ProfileDescriptor {
  readonly id: ProfileId
  readonly kind: ProfileKind
  readonly name: string
  /** Who this person is inside the household. */
  readonly memberId: MemberId
  /** The household this profile starts with. */
  readonly members: readonly Member[]
}

const member = (id: string, name: string): Member => ({ id: toId(id), name })

// The ids of the real members are fixed words, the same on both phones, so that the household
// packages of one land on the right person on the other.
const HOUSEHOLD: readonly Member[] = [member('diego', 'Diego'), member('pablo', 'Pablo')]
const DEMO_HOUSEHOLD: readonly Member[] = [
  member('demo-a', 'Persona A (demo)'),
  member('demo-b', 'Persona B (demo)'),
]

export const PROFILES: readonly ProfileDescriptor[] = [
  { id: 'pablo', kind: 'personal', name: 'Pablo', memberId: toId('pablo'), members: HOUSEHOLD },
  { id: 'diego', kind: 'personal', name: 'Diego', memberId: toId('diego'), members: HOUSEHOLD },
  { id: 'demo', kind: 'demo', name: 'Demo', memberId: toId('demo-a'), members: DEMO_HOUSEHOLD },
]

export function profileDescriptor(id: ProfileId): ProfileDescriptor {
  const found = PROFILES.find((profile) => profile.id === id)
  if (found === undefined) {
    throw new Error(`Perfil desconocido: ${id}`)
  }
  return found
}

/** One IndexedDB database per profile. */
export function databaseName(id: ProfileId): string {
  return `nexo-${id}`
}
