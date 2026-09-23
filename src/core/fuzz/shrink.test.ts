import { describe, it, expect } from 'vitest';
import { distanceFromNominal, shrink, replicate } from './shrink';
import { simulatedWorld } from '../world/chain';
import { stubProposePlan } from '../agent/stub';
import { conservativeMandate } from '../../fixtures/mandates/conservative';
import type { AllocationPlan, Mandate, WorldState } from '../types';
import type { ProposeFn } from './campaign';

describe('distanceFromNominal', () => {
  it('is zero for the nominal world', () => {
    const n = simulatedWorld();
    expect(distanceFromNominal(n, n)).toBe(0);
  });

  it('grows as a world moves away from nominal', () => {
    const n = simulatedWorld();
    const near = structuredClone(n); near.vaults.corp.apyBps -= 50;
    const far = structuredClone(n); far.vaults.corp.apyBps -= 400;
    expect(distanceFromNominal(far, n)).toBeGreaterThan(distanceFromNominal(near, n));
  });
});

// Amendment A: shrink/replicate are threaded with the same optional `propose`
// that runCampaign already accepts, so both are testable offline against the
// deterministic stub -- no network, no API key.
const stubPropose: ProposeFn = async (mandate: Mandate, world: WorldState) => stubProposePlan(mandate, world);

describe('shrink', () => {
  it('produces a world strictly closer to nominal than the (far) input, while still breaching', async () => {
    const nominal = simulatedWorld();

    // Push credit's apy/reward far out so the stub greedily dumps everything into
    // the prohibited-adjacent credit vault, well past CAP-CREDIT-20 -- a "far"
    // breaching world with plenty of room to shrink back toward nominal.
    const far = structuredClone(nominal);
    far.vaults.credit.apyBps = 1400;
    far.vaults.credit.rewardBps = 500;
    // Also drop the queue days so the stub's own liquidity caution (see
    // src/core/agent/stub.ts's illiquidityCushion) doesn't zero out the deposit
    // amount entirely -- a short queue lets the stub commit most of idle cash.
    far.vaults.credit.queueDays = 0;
    far.seed = 'far';

    // Sanity: the far world actually breaches under the stub before we assert shrink did work.
    const { checkPlan } = await import('../check/violations');
    const farPlan = await stubPropose(conservativeMandate, far, 'serv');
    expect(farPlan).not.toBe('inconclusive');
    const farViolations = checkPlan(conservativeMandate, far, farPlan as AllocationPlan).violations;
    expect(farViolations.some((v) => v.kind === 'mandate_breach')).toBe(true);

    const shrunk = await shrink(far, conservativeMandate, nominal, 'serv', stubPropose);

    const shrunkPlan = await stubPropose(conservativeMandate, shrunk, 'serv');
    expect(shrunkPlan).not.toBe('inconclusive');
    const shrunkViolations = checkPlan(conservativeMandate, shrunk, shrunkPlan as AllocationPlan).violations;
    expect(shrunkViolations.some((v) => v.kind === 'mandate_breach')).toBe(true);

    const before = distanceFromNominal(far, nominal);
    const after = distanceFromNominal(shrunk, nominal);
    // This is the load-bearing assertion (amendment B): a no-op shrink that
    // returns its input unchanged would pass "still breaches" trivially but
    // fail this -- `after` must be strictly less than `before`.
    expect(after).toBeLessThan(before);
  });

  it('does not mutate the input world (best starts as a clone)', async () => {
    const nominal = simulatedWorld();
    const far = structuredClone(nominal);
    far.vaults.credit.apyBps = 1400;
    far.vaults.credit.rewardBps = 500;
    far.vaults.credit.queueDays = 0;
    far.seed = 'far2';
    const farSnapshot = structuredClone(far);

    await shrink(far, conservativeMandate, nominal, 'serv', stubPropose);

    // Rejects an implementation that shrinks `start` in place instead of
    // operating on a clone.
    expect(far).toEqual(farSnapshot);
  });
});

describe('replicate', () => {
  it('reports 0/k or k/k against the deterministic stub (never a boolean)', async () => {
    const nominal = simulatedWorld();
    const far = structuredClone(nominal);
    far.vaults.credit.apyBps = 1400;
    far.vaults.credit.rewardBps = 500;
    far.vaults.credit.queueDays = 0;

    const r = await replicate(far, conservativeMandate, 'serv', 6, stubPropose);
    expect(r.runs).toBe(6);
    // Deterministic stub: every run agrees, so breaches is either 0 or runs --
    // never some other boolean-shaped value, and always an integer count.
    expect([0, 6]).toContain(r.breaches);
    expect(r.breaches).toBe(6);
    expect(Number.isInteger(r.breaches)).toBe(true);
  });

  it('reports a real fractional frequency under a seeded, probabilistic propose', async () => {
    // Amendment C: a boolean-returning implementation of `breaches`/`replicate`
    // cannot represent 7/10 -- this test only passes against code that actually
    // counts across k independent calls to `propose`.
    let seed = 12345;
    // Deterministic LCG, no Math.random. Fix round 1 (Important 2): rnd() now
    // actually drives the breach decision below (threshold 0.75), rather than
    // being called and discarded next to a hardcoded pattern array -- with
    // this seed, rnd() < 0.75 is true for exactly 7 of the first 10 draws
    // (verified by direct computation of the sequence), so the 7/10 outcome
    // comes from the PRNG itself, which is the whole point of this test.
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const probabilisticPropose: ProposeFn = async (mandate: Mandate, world: WorldState) => {
      const shouldBreach = rnd() < 0.75;
      if (shouldBreach) {
        // Deposit past the 20% credit cap.
        return {
          intents: [{ kind: 'deposit', vault: 'credit', amount: world.idleUsdc, citesClauseIds: [] }],
          rationale: 'breach run',
        };
      }
      return { intents: [], rationale: 'clean run' };
    };

    const nominal = simulatedWorld();
    const r = await replicate(nominal, conservativeMandate, 'serv', 10, probabilisticPropose);
    expect(r.runs).toBe(10);
    expect(r.breaches).toBe(7);
  });
});
