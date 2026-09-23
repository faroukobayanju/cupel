import { checkPlan } from '../check/violations';
import { proposePlan as realProposePlan, type Engine } from '../agent/subject';
import { VAULT_IDS, type Mandate, type WorldState } from '../types';
import type { ProposeFn } from './campaign';

export function distanceFromNominal(w: WorldState, nominal: WorldState): number {
  let d = 0;
  for (const v of VAULT_IDS) {
    d += Math.abs(w.vaults[v].apyBps - nominal.vaults[v].apyBps);
    d += Math.abs(w.vaults[v].queueDays - nominal.vaults[v].queueDays) * 10;
    d += Math.abs(w.vaults[v].rewardBps - nominal.vaults[v].rewardBps);
  }
  d += Math.abs(w.liabilityDays - nominal.liabilityDays) * 10;
  return d;
}

/**
 * Amendment A: threaded the same optional `propose` that runCampaign accepts, so
 * shrink/replicate/breaches are all testable offline against the stub, defaulting
 * to the real network-calling proposePlan.
 */
async function breaches(w: WorldState, mandate: Mandate, engine: Engine, propose: ProposeFn): Promise<boolean> {
  const plan = await propose(mandate, w, engine);
  if (plan === 'inconclusive') return false;
  return checkPlan(mandate, w, plan).violations.some((v) => v.kind === 'mandate_breach');
}

/**
 * Per-dimension binary search back toward nominal. Returns the most ordinary
 * world that still breaches. Minimality is what makes a finding alarming.
 *
 * Sequential by construction (each probe depends on `best` from the previous
 * step), so no bounded-concurrency pool is needed here -- there is no
 * independent fan-out to bound.
 */
export async function shrink(
  start: WorldState,
  mandate: Mandate,
  nominal: WorldState,
  engine: Engine,
  propose: ProposeFn = realProposePlan,
): Promise<WorldState> {
  let best = structuredClone(start);

  for (const v of VAULT_IDS) {
    for (const field of ['apyBps', 'queueDays', 'rewardBps'] as const) {
      let lo = nominal.vaults[v][field];
      let hi = best.vaults[v][field];
      for (let i = 0; i < 5 && lo !== hi; i++) {
        const mid = Math.round((lo + hi) / 2);
        const probe = structuredClone(best);
        probe.vaults[v][field] = mid;
        if (await breaches(probe, mandate, engine, propose)) { best = probe; hi = mid; }
        else { lo = mid === lo ? hi : mid; }
      }
    }
  }
  best.seed = `${start.seed}#shrunk`;
  return best;
}

/**
 * Non-determinism is handled honestly: report a frequency, never a boolean.
 * Amendment C: with the deterministic stub this will always be 0 or k, which is
 * expected -- the frequency machinery itself is exercised with a probabilistic
 * injected `propose` in shrink.test.ts.
 */
export async function replicate(
  w: WorldState,
  mandate: Mandate,
  engine: Engine,
  k = 10,
  propose: ProposeFn = realProposePlan,
): Promise<{ breaches: number; runs: number }> {
  let count = 0;
  for (let i = 0; i < k; i++) if (await breaches(w, mandate, engine, propose)) count++;
  return { breaches: count, runs: k };
}
