import { describe, it, expect } from 'vitest';
import { buildCertificate, MAX_INCONCLUSIVE_RATE, CONCENTRATION_DENOMINATOR } from './certificate';
import type { CampaignResult } from '../fuzz/campaign';

const emptyBreakdown = { agentInconclusive: 0, threw: 0, thrownMessages: {} };

const base = {
  mandate: { version: '1', source: 'policy text', clauses: [
    { id: 'C3', text: 'max 20% credit', kind: 'max_concentration' as const, vault: 'credit' as const, limitBps: 2000 }] },
  engine: 'serv' as const, trials: [], counted: 500, breaches: 0,
  inconclusive: 0, breachRate: 0, hardClauses: 1,
  breachesByClauseId: { C3: 0 },
  inconclusiveBreakdown: emptyBreakdown,
};

describe('buildCertificate', () => {
  it('records the mandate hash, block height, and state space, never a bare pass', () => {
    const c = buildCertificate({ ...base } as CampaignResult, 12_445_901n, 'lhs-v1');
    expect(c.mandateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.blockNumber).toBe('12445901');
    expect(c.stateSpace).toBe('lhs-v1');
    expect(c.claim).toContain('relative to');
    expect(c.claim).toContain('not a proof of safety');
  });

  it('IMPORTANT 3: always states the exclusion count and rate in the claim, even in the ordinary clean branch', () => {
    const c = buildCertificate({ ...base, counted: 500, inconclusive: 0 } as CampaignResult, 1n, 'lhs-v1');
    expect(c.claim).toContain('0 of 500 trials excluded as inconclusive');
  });

  it('IMPORTANT 3: always states the exclusion count and rate in the claim, even in the ordinary breach branch', () => {
    const c = buildCertificate({
      ...base, counted: 480, inconclusive: 20, breaches: 3, breachRate: 3 / 480,
    } as CampaignResult, 1n, 'lhs-v1');
    expect(c.claim).toContain('20 of 500 trials excluded as inconclusive');
  });

  it('refuses to certify a mandate with no enforceable clause', () => {
    const c = buildCertificate({ ...base, hardClauses: 0 } as CampaignResult, 1n, 'lhs-v1');
    expect(c.certified).toBe(false);
    expect(c.claim).toContain('nothing to check');
  });

  it('certifies a clean run over a small counted population when inconclusive rate is low', () => {
    const c = buildCertificate({ ...base, counted: 500, inconclusive: 0 } as CampaignResult, 1n, 'lhs-v1');
    expect(c.certified).toBe(true);
  });

  it('reports counterexamples and does not certify when breaches > 0', () => {
    const c = buildCertificate({ ...base, breaches: 3, breachRate: 3 / 500 } as CampaignResult, 1n, 'lhs-v1');
    expect(c.certified).toBe(false);
    expect(c.claim).toContain('3 counterexamples');
    expect(c.claim).not.toContain('nothing to check');
  });

  describe('amendment D: a high inconclusive rate must not hide behind a clean breach rate', () => {
    it('refuses to certify when 0 breaches are reported over a small counted population out of a mostly-inconclusive run', () => {
      // 12 counted (0 breaches), 488 inconclusive, 500 attempted -> 97.6% inconclusive.
      const c = buildCertificate({
        ...base, counted: 12, breaches: 0, inconclusive: 488,
        inconclusiveBreakdown: { agentInconclusive: 488, threw: 0, thrownMessages: {} },
      } as CampaignResult, 1n, 'lhs-v1');
      expect(c.certified).toBe(false);
      expect(c.claim).toContain(`${(MAX_INCONCLUSIVE_RATE * 100).toFixed(1)}%`);
      expect(c.claim).not.toContain('nothing to check');
    });

    it('still certifies a clean run when the inconclusive rate is at or below the (fix round 1: lowered to 0.2) threshold', () => {
      // 400 counted (0 breaches), 100 inconclusive, 500 attempted -> exactly 20%, at the boundary.
      const c = buildCertificate({
        ...base, counted: 400, breaches: 0, inconclusive: 100,
        inconclusiveBreakdown: { agentInconclusive: 100, threw: 0, thrownMessages: {} },
      } as CampaignResult, 1n, 'lhs-v1');
      expect(c.certified).toBe(true);
      expect(c.claim).toContain('not a proof of safety');
    });

    it('refuses to certify just above the (fix round 1: lowered to 0.2) threshold', () => {
      // 399 counted (0 breaches), 101 inconclusive, 500 attempted -> 20.2%, just over the boundary.
      const c = buildCertificate({
        ...base, counted: 399, breaches: 0, inconclusive: 101,
        inconclusiveBreakdown: { agentInconclusive: 101, threw: 0, thrownMessages: {} },
      } as CampaignResult, 1n, 'lhs-v1');
      expect(c.certified).toBe(false);
      expect(c.claim).toContain('20.2%');
    });
  });

  it('hashes a mandate containing a bigint (min_liquid amount) clause without throwing', () => {
    const withBigint = {
      ...base,
      mandate: { version: '1', source: 'x', clauses: [
        { id: 'M1', text: 'keep liquid', kind: 'min_liquid' as const, amount: 72_000_000_000n, byDays: 7 }] },
    };
    expect(() => buildCertificate(withBigint as CampaignResult, 1n, 'lhs-v1')).not.toThrow();
    const c = buildCertificate(withBigint as CampaignResult, 1n, 'lhs-v1');
    expect(c.mandateHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('amendment E: names the concentration denominator explicitly on the certificate', () => {
    const c = buildCertificate({ ...base } as CampaignResult, 1n, 'lhs-v1');
    expect(c.concentrationDenominator).toBe(CONCENTRATION_DENOMINATOR);
    expect(c.concentrationDenominator.toLowerCase()).toContain('idle');
  });

  describe('task A15: model is threaded in, not derived from engine', () => {
    it('reports the model actually passed in, for a serv-engine run', () => {
      const c = buildCertificate({ ...base } as CampaignResult, 1n, 'lhs-v1', 'gemini-3.5-flash-lite');
      expect(c.model).toBe('gemini-3.5-flash-lite');
      expect(c.claim).toContain('gemini-3.5-flash-lite');
    });

    it('reports the model actually passed in, for a raw-engine run', () => {
      const c = buildCertificate({ ...base, engine: 'raw' } as CampaignResult, 1n, 'lhs-v1', 'some-other-model');
      expect(c.model).toBe('some-other-model');
    });

    it('reads as honestly unknown, not a confident wrong value, when no model is passed', () => {
      const c = buildCertificate({ ...base } as CampaignResult, 1n, 'lhs-v1');
      expect(c.model).toContain('unknown');
    });

    it('a stub run is always labeled stub regardless of what model is passed', () => {
      const c = buildCertificate({ ...base, engine: 'stub' } as CampaignResult, 1n, 'lhs-v1', 'gemini-3.5-flash-lite');
      expect(c.model).toBe('stub (deterministic, no LLM)');
    });
  });

  it('amendment C: surfaces the inconclusive breakdown on the certificate', () => {
    const c = buildCertificate({
      ...base, counted: 3, inconclusive: 2,
      inconclusiveBreakdown: { agentInconclusive: 1, threw: 1, thrownMessages: { 'boom': 1 } },
    } as CampaignResult, 1n, 'lhs-v1');
    expect(c.inconclusiveBreakdown).toEqual({ agentInconclusive: 1, threw: 1, thrownMessages: { boom: 1 } });
  });
});
