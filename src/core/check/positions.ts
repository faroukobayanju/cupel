import { VAULT_IDS, type AllocationPlan, type Usdc, type VaultId, type WorldState } from '../types';

/** A redeem intent that hasn't cleared the vault's async claim queue yet. */
export interface PendingRedemption { vault: VaultId; amount: Usdc; queueDays: number }

export interface Projection {
  positions: Record<VaultId, Usdc>;
  idle: Usdc;
  /**
   * Redemptions in flight. IXS vaults are async-claim: a redeem intent does not
   * land back in `idle` immediately, it queues for `queueDays` before it is
   * claimable. Keeping it separate from `idle` stops liquidity checks from
   * over-reporting what is actually spendable today.
   */
  pending: PendingRedemption[];
  total: Usdc;
}

export function projectPositions(world: WorldState, plan: AllocationPlan): Projection {
  const positions = { ...world.heldUsdc };
  const pending: PendingRedemption[] = [];
  let idle = world.idleUsdc;
  for (const i of plan.intents) {
    if (i.amount < 0n) throw new Error(`negative amount in intent for ${i.vault}`);
    if (i.kind === 'deposit') {
      positions[i.vault] += i.amount;
      idle -= i.amount;
    } else {
      positions[i.vault] -= i.amount;
      pending.push({ vault: i.vault, amount: i.amount, queueDays: world.vaults[i.vault].queueDays });
    }
  }
  const pendingTotal = pending.reduce((a, p) => a + p.amount, 0n);
  const total = VAULT_IDS.reduce((a, v) => a + positions[v], idle) + pendingTotal;
  return { positions, idle, pending, total };
}
