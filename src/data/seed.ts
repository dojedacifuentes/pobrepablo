import { DEFAULT_CATEGORIES, type LocalDate } from '@/domain'
import type { Instant } from './environment'
import type { ProfileDescriptor } from './profiles'
import type { ProfileSnapshot } from './records'

/**
 * What a personal profile holds the first time it is opened: who it belongs to, the household it
 * lives in and the categories everybody starts with. Not a single peso: the person registers
 * every figure.
 */
export function emptyProfile(profile: ProfileDescriptor, today: LocalDate, now: Instant): ProfileSnapshot {
  const stamp = { createdAt: now, updatedAt: now }
  const members = profile.members.map((member) => ({ ...member, ...stamp }))
  const categories = DEFAULT_CATEGORIES.map((category) => ({ ...category, ...stamp }))
  return {
    meta: {
      key: 'profile',
      id: profile.id,
      kind: profile.kind,
      name: profile.name,
      memberId: profile.memberId,
      startedOn: today,
      createdAt: now,
    },
    members,
    categories,
    accounts: [],
    transactions: [],
    rules: [],
    cancelledOccurrences: [],
    coverages: [],
    budgets: [],
    goals: [],
    reservations: [],
    sharedExpenses: [],
    settlements: [],
    settings: [],
    audit: [
      {
        seq: 1,
        at: now,
        operation: 'profile.seed',
        changes: [
          ...members.map((member) => ({
            table: 'members' as const,
            key: member.id,
            action: 'create' as const,
            after: { ...member },
          })),
          ...categories.map((category) => ({
            table: 'categories' as const,
            key: category.id,
            action: 'create' as const,
            after: { ...category },
          })),
        ],
      },
    ],
  }
}
