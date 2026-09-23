import { checkPlan } from '../check/violations';
import { proposePlan as realProposePlan, type Engine } from '../agent/subject';
import { sampleWorlds } from '../world/space';
import { seedFromClauses } from './seed';
import { isHard, type AllocationPlan, type Mandate, type Violation, type WorldState } from '../types';

export interface Trial {
  world: WorldState;
  origin: 'clause-seed' | 'sample';
  status: 'clean' | 'breach' | 'inconclusive';
  plan: AllocationPlan | null;
  violations: Violation[];
}

export interface CampaignResult {
  mandate: Mandate;
  engine: Engine;
  trials: Trial[];
  counted: number;
  breaches: number;
  inconclusive: number;
  breachRate: number;
  hardClauses: number;
  /**
   * Per hard clause id, how many trials (across both clause-seed and sampled
   * origins) had at least one mandate_breach violation naming that clause.
   * Every hard clause in the mandate gets an entry, including 0 for a clause
   * no trial ever breached -- that's a legitimate, reportable outcome (the
   * clause is dead weight against this agent), not an omission.
   */
  breachesByClauseId: Record<string, number>;
}

/** Injectable so the runner (and anything that drives it) can be tested offline. */
export type ProposeFn = (mandate: Mandate, world: WorldState, engine: Engine) => Promise<AllocationPlan | 'inconclusive'>;

/** CUPEL_CONCURRENCY, default 20, clamped to at least 1. */
function concurrencyFromEnv(): number {
  const raw = Number(process.env.CUPEL_CONCURRENCY);
  const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 20;
  return Math.max(1, n);
}

/**
 * Bounded worker pool. Runs `fn` over `items` with at most `concurrency` in flight
 * at once. Results are written into a pre-sized array by each item's own index, so
 * the returned array is always in the original `items` order regardless of which
 * call finishes first — a pool that returns results in completion order would
 * silently scramble which trial belongs to which world.
 */
async function poolMap<T, R>(
  items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const width = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}

export async function runCampaign(opts: {
  mandate: Mandate; nominal: WorldState; n: number; seed: string; engine: Engine; propose?: ProposeFn;
}): Promise<CampaignResult> {
  const { mandate, nominal, n, seed, engine, propose = realProposePlan } = opts;
  const worlds = [
    ...seedFromClauses(mandate, nominal).map((w) => ({ w, origin: 'clause-seed' as const })),
    ...sampleWorlds(nominal, n, seed).map((w) => ({ w, origin: 'sample' as const })),
  ];

  const trials = await poolMap(worlds, concurrencyFromEnv(), async ({ w, origin }): Promise<Trial> => {
    // A single throwing world must not abort the whole campaign: the real
    // proposePlan self-catches, but amendment B lets a custom `propose` be
    // injected, and checkPlan itself can throw (e.g. a negative-amount intent
    // from a malformed plan). Downgrade any failure here the same way proposePlan
    // downgrades its own: to an inconclusive trial, excluded from both the
    // numerator and denominator, leaving every other in-flight trial unaffected.
    try {
      const plan = await propose(mandate, w, engine);
      if (plan === 'inconclusive') {
        return { world: w, origin, status: 'inconclusive', plan: null, violations: [] };
      }
      const { violations } = checkPlan(mandate, w, plan);
      const breaching = violations.filter((v) => v.kind === 'mandate_breach');
      return { world: w, origin, status: breaching.length ? 'breach' : 'clean', plan, violations };
    } catch {
      return { world: w, origin, status: 'inconclusive', plan: null, violations: [] };
    }
  });

  const inconclusive = trials.filter((t) => t.status === 'inconclusive').length;
  const counted = trials.length - inconclusive;
  const breaches = trials.filter((t) => t.status === 'breach').length;

  const breachesByClauseId: Record<string, number> = {};
  for (const c of mandate.clauses.filter(isHard)) breachesByClauseId[c.id] = 0;
  for (const t of trials) {
    const clauseIdsInTrial = new Set(
      t.violations.filter((v) => v.kind === 'mandate_breach' && v.clauseId).map((v) => v.clauseId as string),
    );
    for (const id of clauseIdsInTrial) breachesByClauseId[id] = (breachesByClauseId[id] ?? 0) + 1;
  }

  return {
    mandate, engine, trials, counted, breaches, inconclusive,
    breachRate: counted === 0 ? 0 : breaches / counted,
    hardClauses: mandate.clauses.filter((c) => c.kind !== 'soft_preference').length,
    breachesByClauseId,
  };
}
