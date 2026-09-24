import { describe, it, expect } from 'vitest';
import { localizeByClause, localizeByNode } from './localize';
import type { Trial } from './campaign';

const trial = (rationale: string, cites: string[], breach: boolean): Trial => ({
  world: { seed: 's' } as Trial['world'],
  origin: 'sample',
  status: breach ? 'breach' : 'clean',
  plan: { intents: [{ kind: 'deposit', vault: 'credit', amount: 1n, citesClauseIds: cites }], rationale },
  violations: breach ? [{ kind: 'mandate_breach', clauseId: 'C3', detail: 'over cap' }] : [],
});

const trialWithSummary = (rationale: string, reasoningSummary: string, cites: string[], breach: boolean): Trial => {
  const t = trial(rationale, cites, breach);
  return { ...t, plan: { ...t.plan!, reasoningSummary } };
};

describe('localizeByClause', () => {
  it('names the clause the agent cited while breaching a different one', () => {
    const l = localizeByClause(trial('reward expires soon', ['C1'], true), trial('steady', ['C1'], false));
    expect(l.breachedClauseId).toBe('C3');
    expect(l.citedWhileBreaching).toEqual(['C1']);
  });

  it('surfaces rationale text present only in the breaching run', () => {
    const l = localizeByClause(trial('treated the expiring reward as a liquidity event', ['C1'], true), trial('held steady', ['C1'], false));
    expect(l.divergentPhrases.join(' ')).toMatch(/liquidity/);
  });

  // Amendment E: honest empty results -- these reject an implementation that
  // fabricates a phrase or clause id when it has nothing real to report.
  it('returns an empty result with an explicit reason when there is no passing trial to diff against', () => {
    const l = localizeByClause(trial('anything', ['C1'], true), null);
    expect(l.empty).toBe(true);
    expect(l.emptyReason).toBeTruthy();
    expect(l.divergentPhrases).toEqual([]);
  });

  // Fix round 1 (Minor 3): a vault id must not surface as if it were a causal
  // rationalization -- it's just the name of the vault the agent picked.
  it('excludes a vault id from divergentPhrases even though it appears only in the breaching rationale', () => {
    const l = localizeByClause(
      trial('allocated to credit for the yield', ['C1'], true),
      trial('held steady across the board', ['C1'], false),
    );
    expect(l.divergentPhrases).not.toContain('credit');
  });

  it('returns an empty divergentPhrases with a reason when the only distinguishing word is a structural identifier', () => {
    // Same rationale shape in both runs; only the vault name differs, and both
    // "credit" and "corp" are vault ids -- so once identifiers are excluded
    // there is nothing left to distinguish the two rationales.
    const l = localizeByClause(
      trial('allocated to credit for now', ['C1'], true),
      trial('allocated to corp for now', ['C1'], false),
    );
    expect(l.divergentPhrases).toEqual([]);
    expect(l.empty).toBe(true);
    expect(l.emptyReason).toBeTruthy();
  });

  it('returns an empty divergentPhrases with a reason when breaching and passing rationale share all words', () => {
    const l = localizeByClause(trial('steady state allocation', ['C1'], true), trial('steady state allocation', ['C1'], false));
    expect(l.divergentPhrases).toEqual([]);
    expect(l.empty).toBe(true);
    expect(l.emptyReason).toBeTruthy();
  });
});

// PROBE RESULTS 8b (R7): the reasoning summary is substantive real prose,
// unlike the short `rationale` field, so localizeByClause diffs it instead
// when present, falling back to `rationale` when it is not.
describe('localizeByClause diffing the reasoning summary', () => {
  it('diffs the reasoning summary rather than the short rationale when both trials have one', () => {
    const l = localizeByClause(
      trialWithSummary('fine', 'The model treated the expiring reward as a permanent liquidity source and overcommitted.', ['C1'], true),
      trialWithSummary('fine', 'The model held steady across the board.', ['C1'], false),
    );
    expect(l.divergentPhrases.join(' ')).toMatch(/overcommitted|permanent|expiring/);
    expect(l.empty).toBe(false);
  });

  it('falls back to rationale when the breaching trial has no reasoning summary', () => {
    const l = localizeByClause(
      trial('treated the expiring reward as a liquidity event', ['C1'], true),
      trial('held steady', ['C1'], false),
    );
    expect(l.divergentPhrases.join(' ')).toMatch(/liquidity/);
  });

  it('still returns an honest empty result when reasoning summaries share all words', () => {
    const l = localizeByClause(
      trialWithSummary('fine', 'steady state allocation across vaults', ['C1'], true),
      trialWithSummary('fine', 'steady state allocation across vaults', ['C1'], false),
    );
    expect(l.divergentPhrases).toEqual([]);
    expect(l.empty).toBe(true);
    expect(l.emptyReason).toBeTruthy();
  });
});

describe('localizeByNode', () => {
  it('is never used as a default and does not crash when node data is absent', () => {
    const l = localizeByNode(trial('x', [], true), undefined);
    expect(l.empty).toBe(true);
    expect(l.emptyReason).toBeTruthy();
    expect(l.nodeId).toBeUndefined();
  });

  it('reports node-scoped attribution when a node id is supplied', () => {
    const l = localizeByNode(trial('x', ['C1'], true), 'node-42');
    expect(l.method).toBe('node');
    expect(l.nodeId).toBe('node-42');
    expect(l.breachedClauseId).toBe('C3');
    expect(l.empty).toBe(false);
  });
});
