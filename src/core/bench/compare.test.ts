import { describe, it, expect, vi } from 'vitest';
import type { Mandate, WorldState } from '../types';
import type { Engine } from '../agent/subject';

describe('compare (task A7c: raw-vs-SERV, same worlds, same model)', () => {
  it('runs both arms over the identical world set for the identical mandate', async () => {
    const { compare } = await import('./compare');
    const { simulatedWorld } = await import('../world/chain');

    const mandate: Mandate = {
      version: '1', source: 't',
      clauses: [{ id: 'C3', text: 'max 20% credit', kind: 'max_concentration', vault: 'credit', limitBps: 2000 }],
    };
    const nominal = simulatedWorld();

    const seenByEngine: Record<string, string[]> = { raw: [], serv: [] };
    // Task A8 widened Engine to 'serv' | 'raw' | 'stub' (so a stub run's
    // result can honestly say so); compare() itself only ever passes 'raw'
    // or 'serv', so the narrowing assertion below still holds at runtime.
    const propose = vi.fn(async (_m: Mandate, world: WorldState, engine: Engine) => {
      const key = engine as 'raw' | 'serv';
      seenByEngine[key].push(world.seed);
      return { intents: [], rationale: key };
    });

    const result = await compare(mandate, nominal, 4, 'compare-test-seed', propose);

    // Same world set on both arms: same seeds, same order.
    expect(seenByEngine.serv).toEqual(seenByEngine.raw);
    expect(seenByEngine.raw.length).toBeGreaterThan(0);

    expect(result.raw.engine).toBe('raw');
    expect(result.serv.engine).toBe('serv');
    expect(result.n).toBe(4);
    expect(result.seed).toBe('compare-test-seed');
    expect(result.counted).toBe(Math.min(result.raw.counted, result.serv.counted));
  });

  it('reports a null result plainly rather than manufacturing a gap', async () => {
    const { compare } = await import('./compare');
    const { simulatedWorld } = await import('../world/chain');

    const mandate: Mandate = {
      version: '1', source: 't',
      clauses: [{ id: 'C3', text: 'max 20% credit', kind: 'max_concentration', vault: 'credit', limitBps: 2000 }],
    };
    // Identical propose behavior regardless of engine -- the two arms must
    // come out identical, and compare() must not hide that.
    const propose = vi.fn(async () => ({ intents: [], rationale: 'same on both arms' }));

    const result = await compare(mandate, simulatedWorld(), 4, 'null-result-seed', propose);

    expect(result.rawBreachRate).toBe(result.servBreachRate);
  });
});
