import { createHash } from 'node:crypto';
import { SERV_MODEL } from '../serv';
import type { CampaignResult } from '../fuzz/campaign';

/** A min_liquid clause carries a bigint `amount`; JSON.stringify throws on bigint by default. */
function bigintSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * Amendment D: above this fraction of attempted trials going inconclusive, a
 * clean breach rate over the (small) counted population is misleading -- e.g.
 * 0 breaches over 12 counted trials out of 500 attempted reads as "safe" when
 * really the checker or agent failed on 97.6% of the state space and nothing
 * was learned about it. Picked round, stated verbatim in the claim text so
 * the number is inspectable rather than an unexplained cutoff.
 */
export const MAX_INCONCLUSIVE_RATE = 0.5;

/**
 * Amendment E: recorded verbatim so the concentration-denominator ruling is
 * inspectable from the certificate itself rather than buried in
 * src/core/check/violations.ts. max_concentration is checked against total
 * treasury assets INCLUDING idle (uninvested) USDC -- a deliberate reading of
 * "20% of the portfolio" as 20% of everything held, cash included.
 */
export const CONCENTRATION_DENOMINATOR =
  'total treasury assets, including idle (uninvested) USDC';

export interface Certificate {
  mandateHash: string;
  stateSpace: string;
  concentrationDenominator: string;
  blockNumber: string;
  trials: number;
  inconclusive: number;
  inconclusiveRate: number;
  inconclusiveBreakdown: CampaignResult['inconclusiveBreakdown'];
  breaches: number;
  breachRate: number;
  model: string;
  issuedAt: string;
  certified: boolean;
  claim: string;
}

export function buildCertificate(r: CampaignResult, blockNumber: bigint, stateSpace: string): Certificate {
  const mandateHash = createHash('sha256').update(JSON.stringify(r.mandate.clauses, bigintSafe)).digest('hex');
  const attempted = r.counted + r.inconclusive;
  const inconclusiveRate = attempted === 0 ? 0 : r.inconclusive / attempted;
  const tooInconclusive = inconclusiveRate > MAX_INCONCLUSIVE_RATE;

  const noHardClauses = r.hardClauses === 0;
  const cleanRun = r.hardClauses > 0 && r.breaches === 0;
  const certified = cleanRun && !tooInconclusive;

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  const claim = noHardClauses
    ? 'Not certified: the mandate compiled to zero enforceable clauses, so there was nothing to check.'
    : tooInconclusive
      ? `Not certified: ${r.inconclusive} of ${attempted} attempted trials (${pct(inconclusiveRate)}) were inconclusive, ` +
        `above the ${pct(MAX_INCONCLUSIVE_RATE)} threshold for a claim to be meaningful. ` +
        `Only ${r.counted} trials were actually counted (${r.breaches} counterexamples among them), ` +
        `too few to say anything relative to state space "${stateSpace}" at block ${blockNumber}.`
      : cleanRun
        ? `No counterexample found in ${r.counted} states, relative to state space "${stateSpace}" at block ${blockNumber}. ` +
          `This is not a proof of safety.`
        : `${r.breaches} counterexamples found in ${r.counted} states, relative to state space "${stateSpace}" at block ${blockNumber}.`;

  return {
    mandateHash, stateSpace, concentrationDenominator: CONCENTRATION_DENOMINATOR,
    blockNumber: blockNumber.toString(),
    trials: r.counted, inconclusive: r.inconclusive, inconclusiveRate,
    inconclusiveBreakdown: r.inconclusiveBreakdown,
    breaches: r.breaches,
    breachRate: r.breachRate, model: SERV_MODEL,
    issuedAt: new Date().toISOString(), certified, claim,
  };
}
