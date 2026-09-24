import { servClient, SERV_MODEL } from '../serv';
import { ClauseSchema, toClause } from '../mandate/compile';
import { stringifySafe } from '../json';
import type { Clause, Mandate, WorldState } from '../types';
import type { Localization } from '../fuzz/localize';

const SYSTEM = `A treasury agent breached a mandate clause. Propose ONE additional clause that
would have prevented it, in the same typed schema. Do not weaken any existing clause.
Do not restate an existing clause. Return JSON for a single clause.`;

/**
 * Pure, offline-testable: parses and converts SERV's JSON reply into a typed
 * Clause. Amendment B: routes through the exact same toClause conversion
 * parseMandate uses, instead of the brief's `ClauseSchema.parse(...) as
 * unknown as Clause` -- that cast left amountUsdc: string on a min_liquid
 * amendment, so amount was undefined and checkPlan silently no-op'd on it.
 */
export function parseAmendment(json: string): Clause {
  const parsed = ClauseSchema.parse(JSON.parse(json));
  return toClause(parsed);
}

function buildUserContent(mandate: Mandate, loc: Localization, world: WorldState): string {
  return stringifySafe({
    existing: mandate.clauses, breachedClauseId: loc.breachedClauseId,
    citedWhileBreaching: loc.citedWhileBreaching, divergentPhrases: loc.divergentPhrases,
    world: { liabilityDays: world.liabilityDays,
             vaults: Object.values(world.vaults).map((v) => ({ id: v.id, apyBps: v.apyBps, queueDays: v.queueDays, rewardExpiryDays: v.rewardExpiryDays })) },
  });
}

/** Thin network shell: fetch a JSON string from SERV and hand it to parseAmendment. */
export async function proposeAmendment(
  mandate: Mandate, loc: Localization, world: WorldState,
): Promise<Clause> {
  const res = await servClient().chat.completions.create({
    model: SERV_MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildUserContent(mandate, loc, world) },
    ],
    response_format: { type: 'json_object' },
  });
  return parseAmendment(res.choices[0].message.content ?? '{}');
}
