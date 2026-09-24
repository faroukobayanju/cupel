import { describe, it, expect } from 'vitest';
import { parseMandate, hardClauseCount } from './compile';

describe('parseMandate', () => {
  it('converts a percentage cap into basis points', () => {
    const m = parseMandate('src', JSON.stringify({
      clauses: [{ id: 'C3', text: 'no more than 20% in private credit', kind: 'max_concentration', vault: 'credit', limitBps: 2000 }],
    }));
    expect(m.clauses[0]).toMatchObject({ kind: 'max_concentration', limitBps: 2000 });
  });

  it('converts a decimal USDC string into base units', () => {
    const m = parseMandate('src', JSON.stringify({
      clauses: [{ id: 'C1', text: 'keep 50000 liquid within 30 days', kind: 'min_liquid', amountUsdc: '50000', byDays: 30 }],
    }));
    expect(m.clauses[0]).toMatchObject({ kind: 'min_liquid', amount: 50_000_000_000n });
    const c = m.clauses[0] as Extract<typeof m.clauses[0], { kind: 'min_liquid' }>;
    expect(typeof c.amount).toBe('bigint');
  });

  it('converts a decimal (fractional) USDC string into base units without a float round-trip', () => {
    const m = parseMandate('src', JSON.stringify({
      clauses: [{ id: 'C2', text: 'keep 1234.56 liquid', kind: 'min_liquid', amountUsdc: '1234.56', byDays: 7 }],
    }));
    expect(m.clauses[0]).toMatchObject({ kind: 'min_liquid', amount: 1_234_560_000n });
  });

  it('passes through clause kinds that need no conversion', () => {
    const m = parseMandate('src', JSON.stringify({
      clauses: [
        { id: 'C4', text: 'never hold btc', kind: 'prohibited_vault', vault: 'btc' },
        { id: 'C5', text: '7 days notice', kind: 'min_notice_cover', days: 7 },
      ],
    }));
    expect(m.clauses[0]).toMatchObject({ kind: 'prohibited_vault', vault: 'btc' });
    expect(m.clauses[1]).toMatchObject({ kind: 'min_notice_cover', days: 7 });
  });

  it('records the exact source string', () => {
    const m = parseMandate('the raw policy text', JSON.stringify({ clauses: [] }));
    expect(m.source).toBe('the raw policy text');
    expect(m.version).toBe('1');
  });

  it('rejects malformed JSON matching the schema violations', () => {
    expect(() => parseMandate('src', JSON.stringify({
      clauses: [{ id: 'C1', text: 'bad', kind: 'max_concentration', vault: 'credit', limitBps: 20_001 }],
    }))).toThrow();
  });
});

describe('mandates with nothing enforceable', () => {
  it('reports zero hard clauses when the policy is pure judgment', () => {
    const m = parseMandate('src', JSON.stringify({
      clauses: [{ id: 'C1', text: 'be prudent', kind: 'soft_preference' }],
    }));
    expect(hardClauseCount(m)).toBe(0);
  });

  it('counts every non-soft clause as hard', () => {
    const m = parseMandate('src', JSON.stringify({
      clauses: [
        { id: 'C1', text: 'be prudent', kind: 'soft_preference' },
        { id: 'C2', text: 'no btc', kind: 'prohibited_vault', vault: 'btc' },
      ],
    }));
    expect(hardClauseCount(m)).toBe(1);
  });
});
