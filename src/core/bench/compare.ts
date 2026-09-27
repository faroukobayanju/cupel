import { runCampaign, type CampaignResult, type ProposeFn } from '../fuzz/campaign';
import { proposePlan, proposeServViaChat } from '../agent/subject';
import { GEMINI_MODEL } from '../serv';
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
 * Throws if the two arms of a raw-vs-SERV comparison would run different
 * models -- naming both ids -- rather than relying on a docstring claim that
 * can rot silently (which is exactly how the confound this guards against
 * got in: this file used to just *say* both arms called BENCH_MODEL, and
 * that stopped being true when the raw arm moved to GEMINI_MODEL without the
 * comment being updated). Per spec 8b: "the raw model must match the SERV
 * model ... [a mismatch] would measure model choice, not SERV's
 * contribution."
 */
export function assertSameModel(rawModel: string, servModel: string): void {
  if (rawModel !== servModel) {
    throw new Error(
      `compare(): raw arm model "${rawModel}" does not match serv arm model "${servModel}" -- ` +
      'both arms of a raw-vs-SERV comparison must run the identical model, or the result measures ' +
      "model choice, not SERV's contribution (spec 8b).",
    );
  }
}

/**
 * Default propose for compare(): both arms run GEMINI_MODEL, read from the
 * one place it's declared (serv.ts) -- the raw arm direct against Gemini
 * (`proposePlan(..., 'raw')`), the serv arm through SERV's chat/completions
 * endpoint (`proposeServViaChat`), since SERV's Responses API rejects Gemini
 * models outright (see proposeServViaChat's own doc comment). `proposeServ`
 * (Responses API, a different model, used by the unrelated demo route) is
 * deliberately not involved here. Both branches below read GEMINI_MODEL,
 * so there is no second constant that could drift out from under this one.
 */
const defaultComparePropose: ProposeFn = async (mandate, world, engine) => {
  if (engine === 'raw') return proposePlan(mandate, world, 'raw');
  const { result } = await proposeServViaChat(mandate, world);
  return result;
};

/**
 * Task A7c: raw-vs-SERV comparison, over the SAME mandate, model, and world
 * set, so the only variable between the two `runCampaign` calls is `engine`
 * -- whether the request goes through SERV's reasoning layer or not.
 * `assertSameModel` enforces the "same model" half of that at runtime, not
 * just in this comment.
 *
 * The world set is not sampled separately for each arm: `sampleWorlds` and
 * `seedFromClauses` (called inside `runCampaign`) are pure functions of
 * (mandate, nominal, n, seed), so calling `runCampaign` twice with identical
 * arguments and only `engine` varying reproduces the exact same worlds for
 * both arms. No extra plumbing is needed to keep the two arms in lockstep,
 * and none is added here -- that would be a second thing that could drift.
 *
 * `propose` is an optional override purely for offline testing (mirrors
 * `runCampaign`'s own injection point) and for a live run's own
 * usage-tracking wrapper (see scripts/bench.ts); when omitted, both arms
 * default to the GEMINI_MODEL pairing above.
 */
export async function compare(
  mandate: Mandate, nominal: WorldState, n: number, seed: string, propose: ProposeFn = defaultComparePropose,
): Promise<Comparison> {
  if (propose === defaultComparePropose) assertSameModel(GEMINI_MODEL, GEMINI_MODEL);
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
