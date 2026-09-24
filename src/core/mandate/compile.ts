import { parseUnits } from 'viem';
import { MandateSchema, ClauseSchema, type ParsedClause } from './schema';
import { SERV_MODEL, KRONOS_MODEL, servClient } from '../serv';
import { isHard, type Clause, type Mandate } from '../types';

const SYSTEM = `You convert a treasury policy into typed clauses.
Vaults: mmf (Fidelity USD Money Market), corp (BlackRock Corporate Bond), credit (Private Credit), btc (BTC Real Yield).
Rules:
- Give every clause a short stable id: C1, C2, C3...
- Copy the exact source sentence into "text".
- Percentages become integer basis points: 20% -> 2000.
- Amounts become decimal USDC strings, no symbols: "50000".
- Use soft_preference ONLY for judgment that cannot be expressed as a numeric limit.
- Never invent a limit the policy does not state.
Return JSON matching the schema. No prose.`;

/**
 * Amendment A/B: the ONLY place that converts a schema-shaped parsed clause
 * (amountUsdc: string) into a typed domain Clause (amount: bigint). Both
 * parseMandate and proposeAmendment route through this so there is exactly
 * one conversion to keep correct -- no separate cast that can drift out of
 * sync with it (that drift was the task-10 brief's `as unknown as Clause` bug).
 */
export function toClause(c: ParsedClause): Clause {
  return c.kind === 'min_liquid'
    ? { id: c.id, text: c.text, kind: 'min_liquid', amount: parseUnits(c.amountUsdc, 6), byDays: c.byDays }
    : c;
}

/** Pure, offline-testable: no network call. All conversion logic lives here. */
export function parseMandate(source: string, json: string): Mandate {
  const parsed = MandateSchema.parse(JSON.parse(json));
  const clauses: Clause[] = parsed.clauses.map(toClause);
  return { version: '1', source, clauses };
}

/** Thin network shell: fetch a JSON string from SERV and hand it to parseMandate. */
export async function compileMandate(source: string): Promise<Mandate> {
  const res = await servClient().chat.completions.create({
    model: KRONOS_MODEL || SERV_MODEL,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: source }],
    response_format: { type: 'json_object' },
  });
  return parseMandate(source, res.choices[0].message.content ?? '{}');
}

export const hardClauseCount = (m: Mandate): number => m.clauses.filter(isHard).length;

/** Re-exported so proposeAmendment's shell can validate against the same schema. */
export { ClauseSchema };
