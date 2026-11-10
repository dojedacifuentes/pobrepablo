import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Scale, Users } from 'lucide-react'
import type { TransactionRecord } from '@/data'
import { Amount } from '@/ui/Amount'
import { type Names, describeMovement } from './movements'

function Icon({ transaction }: { readonly transaction: TransactionRecord }) {
  const props = { size: 18, 'aria-hidden': true } as const
  switch (transaction.kind) {
    case 'expense':
      return <ArrowUpRight {...props} />
    case 'income':
      return <ArrowDownLeft {...props} />
    case 'transfer':
      return <ArrowLeftRight {...props} />
    case 'shared_payment':
    case 'settlement':
      return <Users {...props} />
    case 'adjustment':
      return <Scale {...props} />
  }
}

/** One movement in a list: what it was, where, and how much. A voided one stays, crossed out. */
export function MovementRow({ transaction, names }: { readonly transaction: TransactionRecord; readonly names: Names }) {
  const line = describeMovement(transaction, names)
  return (
    <li className={`flex min-h-14 items-center gap-3 px-3.5 py-2 ${transaction.voided ? 'opacity-55' : ''}`}>
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
          transaction.kind === 'income' ? 'bg-positive/15 text-positive' : 'bg-raised text-muted'
        }`}
      >
        <Icon transaction={transaction} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-[0.9375rem] font-medium text-ink ${transaction.voided ? 'line-through' : ''}`}>
          {line.title}
        </span>
        <span className="truncate text-[0.8125rem] text-muted">
          {transaction.voided ? `Anulado · ${line.detail}` : line.detail}
        </span>
      </span>
      <Amount
        value={line.amount}
        tone={transaction.voided ? 'muted' : line.tone}
        signed={line.signed}
        className={`shrink-0 text-[0.9375rem] font-semibold ${transaction.voided ? 'line-through' : ''}`}
      />
    </li>
  )
}
