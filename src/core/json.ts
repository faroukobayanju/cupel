/**
 * Money in this codebase is bigint end-to-end, and `JSON.stringify` throws on
 * bigint by default. Any value that could contain a Mandate (min_liquid's
 * `amount`), a WorldState/VaultState (maxDeposit, idleUsdc, liabilityUsdc,
 * heldUsdc), a Trial, or a CampaignResult must be stringified with this
 * replacer instead of a bare `JSON.stringify`. One shared helper so a new
 * call site can't reintroduce the bug by copying an ad hoc replacer that
 * later drifts from this one.
 */
export function bigintSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** Convenience wrapper: JSON.stringify with the bigint-safe replacer applied. */
export function stringifySafe(value: unknown, space?: number): string {
  return JSON.stringify(value, bigintSafe, space);
}
