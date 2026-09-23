import { describe, it, expect } from 'vitest';
import { sampleWorlds } from './space';
import { simulatedWorld } from './chain';

describe('sampleWorlds', () => {
  it('is deterministic for a given seed', () => {
    const a = sampleWorlds(simulatedWorld(), 20, 'seed-1');
    const b = sampleWorlds(simulatedWorld(), 20, 'seed-1');
    expect(a.map((w) => w.vaults.corp.apyBps)).toEqual(b.map((w) => w.vaults.corp.apyBps));
  });

  it('spreads samples across each dimension rather than clustering', () => {
    const apys = sampleWorlds(simulatedWorld(), 40, 's').map((w) => w.vaults.corp.apyBps);
    expect(Math.max(...apys) - Math.min(...apys)).toBeGreaterThan(100);
  });
});
