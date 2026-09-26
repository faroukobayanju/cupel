import { checkPlan } from '../check/violations';
import type { AllocationPlan, Clause, Mandate, VaultId, VaultState, WorldState } from '../types';

/**
 * Replays the frozen benchmark fixture (src/fixtures/bench-result.json) through
 * the real (frozen) checker, independently of whatever engine produced the
 * stored plans. The fixture stores money as decimal strings (JSON has no
 * bigint) -- these revive functions are the read-side mirror of
 * core/json.ts's bigintSafe write side. Only used by /api/verify and this
 * file's own test; the campaign path never round-trips through JSON.
 */

interface JsonVaultState extends Omit<VaultState, 'maxDeposit'> { maxDeposit: string }
interface JsonWorldState extends Omit<WorldState, 'blockNumber' | 'vaults' | 'idleUsdc' | 'heldUsdc' | 'liabilityUsdc'> {
  blockNumber: string;
  vaults: Record<VaultId, JsonVaultState>;
  idleUsdc: string;
  heldUsdc: Record<VaultId, string>;
  liabilityUsdc: string;
}
interface JsonIntent { kind: 'deposit' | 'redeem'; vault: VaultId; amount: string; citesClauseIds: string[] }
interface JsonPlan { intents: JsonIntent[]; rationale: string }
export interface JsonTrial { world: JsonWorldState; status: string; plan: JsonPlan | null }
export interface JsonClause { id: string; text: string; kind: Clause['kind']; vault?: VaultId; amount?: string; byDays?: number; limitBps?: number; days?: number }
export interface JsonMandate { version: string; source: string; clauses: JsonClause[] }
export interface JsonArm { mandate: JsonMandate; trials: JsonTrial[]; counted: number; breaches: number; breachRate: number }

function reviveWorld(w: JsonWorldState): WorldState {
  const vaults = {} as Record<VaultId, VaultState>;
  for (const id of Object.keys(w.vaults) as VaultId[]) {
    vaults[id] = { ...w.vaults[id], maxDeposit: BigInt(w.vaults[id].maxDeposit) };
  }
  const heldUsdc = {} as Record<VaultId, bigint>;
  for (const id of Object.keys(w.heldUsdc) as VaultId[]) heldUsdc[id] = BigInt(w.heldUsdc[id]);
  return {
    ...w, vaults, heldUsdc,
    blockNumber: BigInt(w.blockNumber), idleUsdc: BigInt(w.idleUsdc), liabilityUsdc: BigInt(w.liabilityUsdc),
  };
}

function revivePlan(p: JsonPlan): AllocationPlan {
  return { rationale: p.rationale, intents: p.intents.map((i) => ({ ...i, amount: BigInt(i.amount) })) };
}

export function reviveMandate(m: JsonMandate): Mandate {
  const clauses: Clause[] = m.clauses.map((c) => {
    if (c.kind === 'min_liquid') return { id: c.id, text: c.text, kind: 'min_liquid', amount: BigInt(c.amount!), byDays: c.byDays! };
    return c as Clause;
  });
  return { version: m.version, source: m.source, clauses };
}

export interface ReplayResult {
  recomputedCounted: number;
  recomputedBreaches: number;
  recomputedBreachRate: number;
  recordedCounted: number;
  recordedBreaches: number;
  recordedBreachRate: number;
  matches: boolean;
}

/**
 * Re-runs the frozen, offline checker over every non-inconclusive trial in a
 * benchmark arm and compares the result to the numbers the fixture already
 * claims. This never calls a network or an LLM -- it proves the recorded
 * breach counts are what the (frozen, auditable) checker actually produces
 * from the stored worlds and plans, not numbers typed into a JSON file.
 */
export function replayArm(arm: JsonArm): ReplayResult {
  const mandate = reviveMandate(arm.mandate);
  let counted = 0;
  let breaches = 0;
  for (const t of arm.trials) {
    if (t.plan === null) continue; // inconclusive trials are excluded from both count and rate, same as runCampaign
    counted += 1;
    const world = reviveWorld(t.world);
    const plan = revivePlan(t.plan);
    const { violations } = checkPlan(mandate, world, plan);
    if (violations.some((v) => v.kind === 'mandate_breach')) breaches += 1;
  }
  const recomputedBreachRate = counted === 0 ? 0 : breaches / counted;
  return {
    recomputedCounted: counted,
    recomputedBreaches: breaches,
    recomputedBreachRate,
    recordedCounted: arm.counted,
    recordedBreaches: arm.breaches,
    recordedBreachRate: arm.breachRate,
    matches: counted === arm.counted && breaches === arm.breaches,
  };
}
