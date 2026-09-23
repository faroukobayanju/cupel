import { VAULT_IDS } from '../types';
import { DIMENSIONS } from '../world/space';
import type { Trial } from './campaign';

/**
 * Fix round 1 (Minor 3): identifiers that are structural, not insight. A vault
 * id like "credit" appears only in a breaching run's rationale simply because
 * that's the vault the agent picked -- it reads like a causal explanation but
 * is just a name. Excluded before the length-heuristic divergence diff below,
 * on top of (not instead of) that heuristic.
 */
const VAULT_ID_WORDS = new Set<string>(VAULT_IDS.map((v) => v.toLowerCase()));
const DIMENSION_FIELD_WORDS = new Set<string>(Object.keys(DIMENSIONS).map((k) => k.toLowerCase()));

function wordsOf(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 0));
}

/** Splits each id (e.g. "CAP-CREDIT-20") into its constituent words the same way rationale text is tokenized. */
function identifierWords(ids: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    for (const w of wordsOf(id)) out.add(w);
  }
  return out;
}

export interface Localization {
  method: 'node' | 'clause';
  breachedClauseId: string | null;
  citedWhileBreaching: string[];
  divergentPhrases: string[];
  nodeId?: string;
  /**
   * Amendment E: honest empty results. When localization has nothing to report
   * (no passing trial to diff against, or no divergent phrase survived the
   * diff), `empty` is true and `emptyReason` says why -- never fabricate a
   * phrase or clause id to make the result look like a finding.
   */
  empty: boolean;
  emptyReason?: string;
}

/**
 * Primary path. Depends on SERV exposing per-node reasoning structure, which is
 * UNVERIFIED (the documented API surface is only `reasoning: { effort, summary }`,
 * nothing about node ids). Never used as a default anywhere; callers must opt in
 * explicitly and must not crash when node data is absent.
 */
export function localizeByNode(breaching: Trial, nodeId: string | null | undefined): Localization {
  if (!nodeId) {
    return {
      method: 'node', nodeId: undefined,
      breachedClauseId: null, citedWhileBreaching: [], divergentPhrases: [],
      empty: true, emptyReason: 'no node id available (per-node reasoning structure is unverified/absent)',
    };
  }
  return {
    method: 'node', nodeId,
    breachedClauseId: breaching.violations.find((v) => v.kind === 'mandate_breach')?.clauseId ?? null,
    citedWhileBreaching: breaching.plan?.intents.flatMap((i) => i.citesClauseIds) ?? [],
    divergentPhrases: [],
    empty: false,
  };
}

/**
 * Fallback path, built unconditionally regardless of whether localizeByNode ever
 * becomes usable. Works today with no network: cites-based attribution plus a
 * rationale-word diff between a breaching trial and a passing one.
 */
export function localizeByClause(breaching: Trial, passing: Trial | null | undefined): Localization {
  const breachedClauseId = breaching.violations.find((v) => v.kind === 'mandate_breach')?.clauseId ?? null;
  const citedWhileBreaching = [...new Set(breaching.plan?.intents.flatMap((i) => i.citesClauseIds) ?? [])];

  if (!passing) {
    return {
      method: 'clause', breachedClauseId, citedWhileBreaching, divergentPhrases: [],
      empty: true, emptyReason: 'no passing trial available to diff rationale against',
    };
  }

  // Structural identifiers known at this point: vault ids, DIMENSIONS field
  // names, and every clause id either trial cited or breached against. Removed
  // before the divergence diff so a picked-vault name can't masquerade as a
  // causal phrase (Minor 3).
  const clauseIdWords = identifierWords([
    ...citedWhileBreaching,
    ...(passing.plan?.intents.flatMap((i) => i.citesClauseIds) ?? []),
    ...breaching.violations.map((v) => v.clauseId),
    ...passing.violations.map((v) => v.clauseId),
  ]);
  const structural = new Set([...VAULT_ID_WORDS, ...DIMENSION_FIELD_WORDS, ...clauseIdWords]);

  const words = (s: string) => new Set([...wordsOf(s)].filter((w) => w.length > 4 && !structural.has(w)));
  const bWords = words(breaching.plan?.rationale ?? '');
  const pWords = words(passing.plan?.rationale ?? '');
  const divergentPhrases = [...bWords].filter((w) => !pWords.has(w));

  return {
    method: 'clause', breachedClauseId, citedWhileBreaching, divergentPhrases,
    empty: divergentPhrases.length === 0,
    ...(divergentPhrases.length === 0 ? { emptyReason: 'no rationale word appears in the breaching run but not the passing run' } : {}),
  };
}
