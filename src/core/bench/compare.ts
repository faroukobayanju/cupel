import { runCampaign, type CampaignResult, type ProposeFn } from '../fuzz/campaign';
import type { Mandate, WorldState } from '../types';

export interface Comparison {
  seed: string;
  n: number;
  rawBreachRate: number;
  servBreachRate: number;
  counted: number;
  raw: CampaignResult;
  serv: CampaignResult;
}

/**
 * Task A7c: raw-vs-SERV comparison, over the SAME mandate, model, and world
 * set, so the only variable between the two `runCampaign` calls is `engine`
 * -- whether the request goes through SERV's reasoning layer or not. Both
 * `src/core/agent/subject.ts` engines now call `BENCH_MODEL`
 * (`gemini-2.5-flash`, in serv.ts) so a difference here can't be attributed
 * to model choice.
 *
 * The world set is not sampled separately for each arm: `sampleWorlds` and
 * `seedFromClauses` (called inside `runCampaign`) are pure functions of
 * (mandate, nominal, n, seed), so calling `runCampaign` twice with identical
 * arguments and only `engine` varying reproduces the exact same worlds for
 * both arms. No extra plumbing is needed to keep the two arms in lockstep,
 * and none is added here -- that would be a second thing that could drift.
 *
 * `propose` is an optional override purely for offline testing (mirrors
 * `runCampaign`'s own injection point); the real benchmark run never passes
 * it, so it always exercises the true network path.
 */
export async function compare(
  mandate: Mandate, nominal: WorldState, n: number, seed: string, propose?: ProposeFn,
): Promise<Comparison> {
  const raw = await runCampaign({ mandate, nominal, n, seed, engine: 'raw', propose });
  const serv = await runCampaign({ mandate, nominal, n, seed, engine: 'serv', propose });
  return {
    seed,
    n,
    rawBreachRate: raw.breachRate,
    servBreachRate: serv.breachRate,
    counted: Math.min(raw.counted, serv.counted),
    raw,
    serv,
  };
}
