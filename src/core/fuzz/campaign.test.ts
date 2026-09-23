import { describe, it, expect, vi } from 'vitest';
import type { Trial } from './campaign';
import type { WorldState } from '../types';

vi.mock('../agent/subject', () => ({
  proposePlan: vi.fn()
    .mockResolvedValueOnce('inconclusive')
    .mockResolvedValue({ intents: [], rationale: 'hold' }),
}));

describe('malformed SERV responses', () => {
  it('excludes inconclusive trials from numerator and denominator', async () => {
    const { runCampaign } = await import('./campaign');
    const { simulatedWorld } = await import('../world/chain');
    const r = await runCampaign({
      mandate: { version: '1', source: 't', clauses: [
        { id: 'C3', text: 'max 20% credit', kind: 'max_concentration', vault: 'credit', limitBps: 2000 }] },
      nominal: simulatedWorld(), n: 4, seed: 's', engine: 'serv',
    });
    expect(r.inconclusive).toBe(1);
    expect(r.counted).toBe(r.trials.length - 1);
    expect(r.trials.filter((t: Trial) => t.status === 'inconclusive')).toHaveLength(1);
  });
});

describe('bounded concurrency pool', () => {
  it('returns trials in deterministic world order regardless of completion order', async () => {
    const { runCampaign } = await import('./campaign');
    const { simulatedWorld } = await import('../world/chain');
    const { sampleWorlds } = await import('../world/space');

    const mandate = { version: '1', source: 't', clauses: [] };
    const nominal = simulatedWorld();
    // No hard clauses, so seedFromClauses contributes nothing: worlds are exactly
    // sampleWorlds's output, in this order.
    const expectedSeeds = sampleWorlds(nominal, 8, 'order-test').map((w) => w.seed);

    // Latency is reverse-ordered relative to world order, so the FIRST world to be
    // dispatched is the LAST to resolve. A pool that appends results as they
    // complete (rather than writing them back to their own index) would return
    // trials out of world order here.
    const propose = vi.fn(async (_m: unknown, world: WorldState) => {
      const idx = expectedSeeds.indexOf(world.seed);
      const delayMs = (expectedSeeds.length - idx) * 4;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { intents: [], rationale: `w${idx}` };
    });

    const r = await runCampaign({
      mandate, nominal, n: 8, seed: 'order-test', engine: 'serv', propose,
    });

    expect(r.trials.map((t) => t.world.seed)).toEqual(expectedSeeds);
  });
});
