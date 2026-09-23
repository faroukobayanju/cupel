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
      text: 'At least 40,000 USDC must be reachable within 7 days.',
      kind: 'min_liquid',
      amount: 40_000_000_000n,
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
