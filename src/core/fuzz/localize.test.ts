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

  it('returns an empty divergentPhrases with a reason when breaching and passing rationale share all words', () => {
    const l = localizeByClause(trial('steady state allocation', ['C1'], true), trial('steady state allocation', ['C1'], false));
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
