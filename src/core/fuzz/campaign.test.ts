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

describe('one throwing world does not abort the campaign', () => {
  it('downgrades a thrown error to inconclusive and leaves every other trial unaffected', async () => {
    const { runCampaign } = await import('./campaign');
    const { simulatedWorld } = await import('../world/chain');
    const { sampleWorlds } = await import('../world/space');

    const mandate = { version: '1', source: 't', clauses: [] };
    const nominal = simulatedWorld();
    const expectedSeeds = sampleWorlds(nominal, 6, 'throw-test').map((w) => w.seed);
    const throwingSeed = expectedSeeds[2];

    // Simulates both failure modes the review flagged: a custom propose that
    // rejects instead of resolving to 'inconclusive' (amendment B's whole point is
    // that custom propose implementations get injected), and checkPlan throwing on
    // a malformed plan (e.g. src/core/check/positions.ts:30 on a negative amount).
    const propose = vi.fn(async (_m: unknown, world: WorldState) => {
      if (world.seed === throwingSeed) throw new Error('boom: malformed world');
      return { intents: [], rationale: 'ok' };
    });

    const r = await runCampaign({ mandate, nominal, n: 6, seed: 'throw-test', engine: 'serv', propose });

    expect(r.trials).toHaveLength(6);
    const thrown = r.trials.find((t) => t.world.seed === throwingSeed);
    expect(thrown?.status).toBe('inconclusive');
    expect(r.inconclusive).toBe(1);
    expect(r.counted).toBe(5);
    const others = r.trials.filter((t) => t.world.seed !== throwingSeed);
    expect(others.every((t) => t.status === 'clean')).toBe(true);
  });
});

describe('per-clause breach counts', () => {
  it('counts one entry per hard clause id, including 0 for a clause no trial ever breaches', async () => {
    const { runCampaign } = await import('./campaign');
    const { simulatedWorld } = await import('../world/chain');

    // C1 and C3 breach on every trial (propose below always deposits into
    // both credit and btc, and the caps/prohibition are set to make any
    // position in those vaults a breach). C2 never breaches: nothing ever
    // touches mmf's cap.
    const mandate = {
      version: '1', source: 't',
      clauses: [
        { id: 'C1', text: 'no credit', kind: 'max_concentration' as const, vault: 'credit' as const, limitBps: 0 },
        { id: 'C2', text: 'no mmf', kind: 'max_concentration' as const, vault: 'mmf' as const, limitBps: 0 },
        { id: 'C3', text: 'no btc', kind: 'prohibited_vault' as const, vault: 'btc' as const },
      ],
    };
    const nominal = simulatedWorld();
    const n = 5;

    const propose = vi.fn(async () => ({
      intents: [
        { kind: 'deposit' as const, vault: 'credit' as const, amount: 1_000_000n, citesClauseIds: [] },
        { kind: 'deposit' as const, vault: 'btc' as const, amount: 1_000_000n, citesClauseIds: [] },
      ],
      rationale: 'test',
    }));

    const r = await runCampaign({ mandate, nominal, n, seed: 'per-clause-test', engine: 'serv', propose });

    // Every trial (2 clause-seeds from C1/C3 + n samples) breaches both C1 and C3.
    const totalTrials = r.trials.length;
    expect(r.inconclusive).toBe(0);
    expect(r.breaches).toBe(totalTrials);

    expect(r.breachesByClauseId).toEqual({ C1: totalTrials, C2: 0, C3: totalTrials });

    // Every hard clause id is present, even the one that never breached.
    expect(Object.keys(r.breachesByClauseId).sort()).toEqual(['C1', 'C2', 'C3']);
    expect(r.breachesByClauseId.C2).toBe(0);

    // Sum across clauses can exceed `breaches` (a trial breaching two clauses
    // at once counts once in `breaches` but once per clause here) -- confirm
    // that's exactly what happens rather than the counts silently collapsing.
    const sum = Object.values(r.breachesByClauseId).reduce((a, b) => a + b, 0);
    expect(sum).toBe(2 * totalTrials);
  });
});

describe('actual concurrency', () => {
  it('runs multiple propose calls in flight at once, bounded by CUPEL_CONCURRENCY', async () => {
    const prev = process.env.CUPEL_CONCURRENCY;
    process.env.CUPEL_CONCURRENCY = '3';
    try {
      const { runCampaign } = await import('./campaign');
      const { simulatedWorld } = await import('../world/chain');

      const mandate = { version: '1', source: 't', clauses: [] };
      const nominal = simulatedWorld();

      // Fails against a sequential loop (maxInFlight would stay 1) and fails
      // against an unbounded Promise.all (maxInFlight would hit 12, not <= 3).
      let inFlight = 0;
      let maxInFlight = 0;
      const propose = vi.fn(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight--;
        return { intents: [], rationale: 'ok' };
      });

      await runCampaign({ mandate, nominal, n: 12, seed: 'concurrency-test', engine: 'serv', propose });

      expect(maxInFlight).toBeGreaterThan(1);
      expect(maxInFlight).toBeLessThanOrEqual(3);
    } finally {
      if (prev === undefined) delete process.env.CUPEL_CONCURRENCY;
      else process.env.CUPEL_CONCURRENCY = prev;
    }
  });
});
