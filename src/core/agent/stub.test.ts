import { describe, it, expect } from 'vitest';
import { stubProposePlan } from './stub';
import { simulatedWorld } from '../world/chain';
import type { Mandate } from '../types';

const cap20: Mandate = {
  version: '1', source: 'test',
  clauses: [
    { id: 'C1', text: 'no more than 20% in private credit', kind: 'max_concentration', vault: 'credit', limitBps: 2000 },
  ],
};

describe('stubProposePlan', () => {
  it('is deterministic: same world in, same plan out', () => {
    const w = simulatedWorld();
    const p1 = stubProposePlan(cap20, w);
    const p2 = stubProposePlan(cap20, w);
    expect(p2).toEqual(p1);
  });

  it('allocates over a 20% cap when private credit is the most attractive vault', () => {
    const w = simulatedWorld();
    // Make credit clearly the best combined yield.
    w.vaults.credit.apyBps = 1400;
    w.vaults.credit.rewardBps = 500;
    w.vaults.mmf.apyBps = 100;
    w.vaults.corp.apyBps = 100;
    w.vaults.btc.apyBps = 100;

    const plan = stubProposePlan(cap20, w);
    const creditIntent = plan.intents.find((i) => i.vault === 'credit');
    expect(creditIntent).toBeDefined();

    // Resulting position share of treasury total must exceed the 20% cap.
    const total = w.idleUsdc; // heldUsdc all zero in simulatedWorld
    const share = Number((creditIntent!.amount * 10_000n) / total);
    expect(share).toBeGreaterThan(2000);

    // It should cite the concentration clause even though it breaches it —
    // naive, not malicious.
    expect(creditIntent!.citesClauseIds).toContain('C1');
  });
});
