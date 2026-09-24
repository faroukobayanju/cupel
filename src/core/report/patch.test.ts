import { describe, it, expect, vi } from 'vitest';
import { parseAmendment } from './patch';
import { simulatedWorld } from '../world/chain';
import type { Mandate } from '../types';
import type { Localization } from '../fuzz/localize';

describe('parseAmendment', () => {
  it('converts a min_liquid amendment into a real bigint amount, not a string (amendment B)', () => {
    const c = parseAmendment(JSON.stringify({
      id: 'AMEND-1', text: 'keep 10000 liquid within 3 days', kind: 'min_liquid', amountUsdc: '10000', byDays: 3,
    }));
    expect(c.kind).toBe('min_liquid');
    if (c.kind === 'min_liquid') {
      expect(typeof c.amount).toBe('bigint');
      expect(c.amount).toBe(10_000_000_000n);
      expect((c as unknown as { amountUsdc?: string }).amountUsdc).toBeUndefined();
    }
  });

  it('passes through a max_concentration amendment unchanged', () => {
    const c = parseAmendment(JSON.stringify({
      id: 'AMEND-2', text: 'no more than 10% in credit', kind: 'max_concentration', vault: 'credit', limitBps: 1000,
    }));
    expect(c).toMatchObject({ kind: 'max_concentration', vault: 'credit', limitBps: 1000 });
  });

  it('rejects a malformed amendment', () => {
    expect(() => parseAmendment(JSON.stringify({ id: 'X', text: 'bad', kind: 'max_concentration', vault: 'credit', limitBps: -1 })))
      .toThrow();
  });
});

// A mutable holder read lazily by the mocked client, same pattern as
// subject.test.ts. Prefixed `mock` because vitest hoists vi.mock() above
// other declarations.
let mockContent = '{}';
vi.mock('../serv', () => {
  const fakeClient = () => ({
    chat: { completions: { create: async () => ({ choices: [{ message: { content: mockContent } }] }) } },
  });
  return { servClient: fakeClient, rawClient: fakeClient, SERV_MODEL: 'gpt-6-luna', KRONOS_MODEL: 'gpt-6-luna' };
});

describe('fix round 1, CRITICAL 2: proposeAmendment must not throw on a min_liquid-bearing mandate', () => {
  it('builds its request body and returns a clause instead of throwing uncaught', async () => {
    const { proposeAmendment } = await import('./patch');
    const mandateWithMinLiquid: Mandate = {
      version: '1', source: 'test',
      clauses: [{ id: 'M1', text: 'keep 72000 liquid within 7 days', kind: 'min_liquid', amount: 72_000_000_000n, byDays: 7 }],
    };
    const loc: Localization = {
      method: 'clause', breachedClauseId: 'M1', citedWhileBreaching: [], divergentPhrases: [], empty: true,
    };
    mockContent = JSON.stringify({
      id: 'AMEND-1', text: 'no more than 10% credit', kind: 'max_concentration', vault: 'credit', limitBps: 1000,
    });
    // Before the fix, buildUserContent's bare JSON.stringify({ existing: mandate.clauses, ... })
    // threw synchronously on the bigint `amount` field, uncaught (patch.ts has no
    // try/catch), so this call would reject instead of resolving.
    await expect(proposeAmendment(mandateWithMinLiquid, loc, simulatedWorld())).resolves.toMatchObject({
      kind: 'max_concentration', limitBps: 1000,
    });
  });
});
