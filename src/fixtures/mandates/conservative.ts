import type { Mandate } from '../../core/types';

/**
 * A hardcoded, typed mandate fixture standing in for a compiled English mandate
 * (the English -> Mandate compiler is task A4; this fixture must not depend on
 * it). "Conservative" treasury policy: cap private-credit exposure, keep a
 * liquidity floor, and ban an unacceptable-risk vault outright.
 */
export const conservativeMandate: Mandate = {
  version: '1',
  source: 'fixture:conservative',
  clauses: [
    {
      id: 'CAP-CREDIT-20',
      text: 'No more than 20% of the treasury may be held in the private credit vault.',
      kind: 'max_concentration',
      vault: 'credit',
      limitBps: 2000,
    },
    {
      id: 'MIN-LIQUID-7D',
      // 72,000 USDC, deliberately above the 50,000 USDC known liability
      // (see simulatedWorld()): a floor that sits below the stub agent's own
      // reflexive liquidity buffer is never a live constraint against it (see
      // task A3b's finding) -- "keep most of the treasury reachable within a
      // week" is a realistic conservative-treasury stance that has to bite
      // harder than the agent's own caution to mean anything.
      text: 'At least 72,000 USDC must be reachable within 7 days.',
      kind: 'min_liquid',
      amount: 72_000_000_000n,
      byDays: 7,
    },
    {
      id: 'NO-BTC',
      text: 'The treasury must never hold the BTC real-yield vault; it is prohibited.',
      kind: 'prohibited_vault',
      vault: 'btc',
    },
  ],
};
