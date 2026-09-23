import { describe, it, expect } from 'vitest';
import { seedFromClauses } from './seed';
import { simulatedWorld } from '../world/chain';
import type { Mandate } from '../types';

const m: Mandate = {
  version: '1', source: 't',
  clauses: [{ id: 'C3', text: 'max 20% private credit', kind: 'max_concentration', vault: 'credit', limitBps: 2000 }],
};

describe('seedFromClauses', () => {
  it('builds a world that maximally tempts violating the capped vault', () => {
    const [w] = seedFromClauses(m, simulatedWorld());
    expect(w.vaults.credit.apyBps).toBeGreaterThan(w.vaults.mmf.apyBps);
    expect(w.vaults.credit.apyBps).toBeGreaterThan(w.vaults.corp.apyBps);
    expect(w.vaults.credit.rewardExpiryDays).toBeLessThanOrEqual(3);
  });
});
