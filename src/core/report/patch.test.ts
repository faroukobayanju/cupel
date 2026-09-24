import { describe, it, expect } from 'vitest';
import { parseAmendment } from './patch';

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
