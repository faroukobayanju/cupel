import { describe, it, expect } from 'vitest';
import { projectPositions } from './positions';
import { checkPlan } from './violations';
import type { Mandate, WorldState } from '../types';

const world = (over: Partial<WorldState> = {}): WorldState => ({
  seed: 't', blockNumber: 1n, simulated: true,
  vaults: {
    mmf:    { id: 'mmf',    apyBps: 400,  maxDeposit: 10_000_000_000n, queueDays: 0, rewardBps: 0, rewardExpiryDays: 0, description: '' },
    corp:   { id: 'corp',   apyBps: 600,  maxDeposit: 10_000_000_000n, queueDays: 2, rewardBps: 0, rewardExpiryDays: 0, description: '' },
    credit: { id: 'credit', apyBps: 900,  maxDeposit: 10_000_000_000n, queueDays: 30, rewardBps: 0, rewardExpiryDays: 0, description: '' },
    btc:    { id: 'btc',    apyBps: 800,  maxDeposit: 10_000_000_000n, queueDays: 7, rewardBps: 0, rewardExpiryDays: 0, description: '' },
  },
  idleUsdc: 100_000_000n,
  heldUsdc: { mmf: 0n, corp: 0n, credit: 0n, btc: 0n },
  liabilityUsdc: 0n, liabilityDays: 30,
  ...over,
});

describe('projectPositions', () => {
  it('adds a deposit to the target vault and removes it from idle', () => {
    const r = projectPositions(world(), { intents: [{ kind: 'deposit', vault: 'credit', amount: 25_000_000n, citesClauseIds: [] }], rationale: '' });
    expect(r.positions.credit).toBe(25_000_000n);
    expect(r.idle).toBe(75_000_000n);
  });
});

const cap20: Mandate = {
  version: '1', source: 'test',
  clauses: [{ id: 'C3', text: 'no more than 20% in private credit', kind: 'max_concentration', vault: 'credit', limitBps: 2000 }],
};

describe('max_concentration boundary', () => {
  it('allows exactly 20.0000%', () => {
    const r = checkPlan(cap20, world(), { intents: [{ kind: 'deposit', vault: 'credit', amount: 20_000_000n, citesClauseIds: ['C3'] }], rationale: '' });
    expect(r.violations).toHaveLength(0);
  });

  it('flags one base unit over the cap, with no float rounding', () => {
    const r = checkPlan(cap20, world(), { intents: [{ kind: 'deposit', vault: 'credit', amount: 20_000_001n, citesClauseIds: ['C3'] }], rationale: '' });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].clauseId).toBe('C3');
    expect(r.violations[0].kind).toBe('mandate_breach');
  });
});

describe('unexecutable plans are distinct from breaches', () => {
  it('flags a deposit above maxDeposit as unexecutable, not a breach', () => {
    const w = world();
    w.vaults.corp.maxDeposit = 5_000_000n;
    const r = checkPlan(cap20, w, { intents: [{ kind: 'deposit', vault: 'corp', amount: 6_000_000n, citesClauseIds: [] }], rationale: '' });
    expect(r.violations.map((v) => v.kind)).toContain('unexecutable');
    expect(r.violations.every((v) => v.kind !== 'mandate_breach')).toBe(true);
  });

  it('flags overspending idle USDC as unexecutable', () => {
    const r = checkPlan(cap20, world(), { intents: [{ kind: 'deposit', vault: 'mmf', amount: 500_000_000n, citesClauseIds: [] }], rationale: '' });
    expect(r.violations.some((v) => v.kind === 'unexecutable')).toBe(true);
  });

  it('flags a deposit that pushes an already-near-cap position over maxDeposit, not just a large deposit amount in isolation', () => {
    const w = world({ heldUsdc: { mmf: 0n, corp: 9_000_000n, credit: 0n, btc: 0n } });
    w.vaults.corp.maxDeposit = 10_000_000n; // heldUsdc is just under the cap
    const r = checkPlan(cap20, w, { intents: [{ kind: 'deposit', vault: 'corp', amount: 2_000_000n, citesClauseIds: [] }], rationale: '' });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].kind).toBe('unexecutable');
  });

  it('flags a redeem exceeding the held position as unexecutable, with no mandate_breach', () => {
    const w = world({ heldUsdc: { mmf: 0n, corp: 0n, credit: 10_000_000n, btc: 0n } });
    const r = checkPlan(cap20, w, { intents: [{ kind: 'redeem', vault: 'credit', amount: 15_000_000n, citesClauseIds: [] }], rationale: '' });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].kind).toBe('unexecutable');
    expect(r.violations.every((v) => v.kind !== 'mandate_breach')).toBe(true);
  });
});

describe('async redemption (amendment 2)', () => {
  const minLiquid7: Mandate = {
    version: '1', source: 'test',
    clauses: [{ id: 'L7', text: 'keep at least 50 USDC liquid within 7 days', kind: 'min_liquid', amount: 50_000_000n, byDays: 7 }],
  };

  it('a redeem from a 30-day-queue vault does not satisfy a min_liquid clause with byDays 7', () => {
    // Start with everything parked in credit (30-day queue) and no idle cash.
    const w = world({
      idleUsdc: 0n,
      heldUsdc: { mmf: 0n, corp: 0n, credit: 100_000_000n, btc: 0n },
    });
    const r = checkPlan(minLiquid7, w, {
      intents: [{ kind: 'redeem', vault: 'credit', amount: 100_000_000n, citesClauseIds: ['L7'] }],
      rationale: '',
    });
    // The redeem does NOT land back in idle within 7 days: it queues for 30 days.
    expect(r.violations.some((v) => v.clauseId === 'L7')).toBe(true);
  });

  it('a redeem from a vault whose queue clears within byDays does satisfy min_liquid', () => {
    const w = world({
      idleUsdc: 0n,
      heldUsdc: { mmf: 0n, corp: 0n, credit: 0n, btc: 100_000_000n }, // btc queueDays: 7
    });
    const r = checkPlan(minLiquid7, w, {
      intents: [{ kind: 'redeem', vault: 'btc', amount: 100_000_000n, citesClauseIds: ['L7'] }],
      rationale: '',
    });
    expect(r.violations.some((v) => v.clauseId === 'L7')).toBe(false);
  });

  it('keeps pending redemptions out of idle in the projection', () => {
    const w = world({
      idleUsdc: 0n,
      heldUsdc: { mmf: 0n, corp: 0n, credit: 100_000_000n, btc: 0n },
    });
    const r = projectPositions(w, {
      intents: [{ kind: 'redeem', vault: 'credit', amount: 40_000_000n, citesClauseIds: [] }],
      rationale: '',
    });
    expect(r.idle).toBe(0n);
    expect(r.positions.credit).toBe(60_000_000n);
    expect(r.pending).toEqual([{ vault: 'credit', amount: 40_000_000n, queueDays: 30 }]);
    expect(r.total).toBe(100_000_000n);
  });
});
