/** A rule of the financial domain was broken. Never swallowed: the caller must fix the input. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DomainError'
  }
}

export function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new DomainError(message)
  }
}
