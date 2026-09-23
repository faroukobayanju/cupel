import { projectPositions } from './positions';
import { VAULT_IDS, isHard, type CheckResult, type Mandate, type AllocationPlan, type Violation, type WorldState } from '../types';

/** Floor-division basis points on bigints, for human-readable display only. Never used in a breach decision. */
const bps = (part: bigint, whole: bigint): number =>
  whole === 0n ? 0 : Number((part * 10_000n) / whole);

export function checkPlan(mandate: Mandate, world: WorldState, plan: AllocationPlan): CheckResult {
  const { positions, idle, pending, total, positionAfterIntent } = projectPositions(world, plan);
  const violations: Violation[] = [];

  plan.intents.forEach((i, idx) => {
    const postPosition = positionAfterIntent[idx];
    if (i.kind === 'deposit') {
      // Compare the resulting position, not the intent's own amount: a vault already
      // near its cap via heldUsdc plus a modest new deposit can exceed maxDeposit even
      // though the deposit amount itself looks small in isolation.
      if (postPosition > world.vaults[i.vault].maxDeposit) {
        violations.push({
          kind: 'unexecutable', clauseId: null,
          detail: `deposit of ${i.amount} into ${i.vault} brings the position to ${postPosition}, exceeding maxDeposit ${world.vaults[i.vault].maxDeposit}`,
        });
      }
    } else {
      // A redeem that exceeds the running balance at the time it is applied drives the
      // position negative. Intents apply in sequence, so this must be checked against
      // the running balance (positionAfterIntent), not the opening heldUsdc.
      if (postPosition < 0n) {
        const available = postPosition + i.amount;
        violations.push({
          kind: 'unexecutable', clauseId: null,
          detail: `redeem of ${i.amount} from ${i.vault} exceeds the available position ${available}`,
        });
      }
    }
  });
  if (idle < 0n) {
    violations.push({ kind: 'unexecutable', clauseId: null, detail: `plan spends ${-idle} more USDC than held` });
  }

  for (const c of mandate.clauses.filter(isHard)) {
    switch (c.kind) {
      case 'max_concentration': {
        // total = all vault positions + idle + pending. Deliberate: a mandate saying
        // "no more than 20% in private credit" means 20% of the treasury, and
        // uninvested cash is part of the treasury.
        const breach = positions[c.vault] * 10_000n > BigInt(c.limitBps) * total;
        if (breach) {
          const observed = bps(positions[c.vault], total);
          violations.push({
            kind: 'mandate_breach', clauseId: c.id,
            detail: `${c.vault} at ${observed}bps exceeds ${c.limitBps}bps`,
            observedBps: observed, limitBps: c.limitBps,
          });
        }
        break;
      }
      case 'prohibited_vault': {
        if (positions[c.vault] > 0n) {
          violations.push({ kind: 'mandate_breach', clauseId: c.id, detail: `holds ${positions[c.vault]} in prohibited vault ${c.vault}` });
        }
        break;
      }
      case 'min_liquid': {
        const reachableVaults = VAULT_IDS
          .filter((v) => world.vaults[v].queueDays <= c.byDays)
          .reduce((a, v) => a + positions[v], 0n);
        const reachablePending = pending
          .filter((p) => p.queueDays <= c.byDays)
          .reduce((a, p) => a + p.amount, 0n);
        const reachable = idle + reachableVaults + reachablePending;
        if (reachable < c.amount) {
          violations.push({ kind: 'mandate_breach', clauseId: c.id, detail: `only ${reachable} reachable within ${c.byDays}d, needs ${c.amount}` });
        }
        break;
      }
      case 'min_notice_cover': {
        for (const v of VAULT_IDS) {
          if (positions[v] > 0n && world.vaults[v].queueDays > world.liabilityDays - c.days) {
            violations.push({ kind: 'mandate_breach', clauseId: c.id, detail: `${v} queue ${world.vaults[v].queueDays}d leaves under ${c.days}d cover before a liability in ${world.liabilityDays}d` });
          }
        }
        break;
      }
    }
  }
  return { violations, postPositions: positions };
}
