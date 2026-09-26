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
 * Task A12: mirrors PLAN_JSON_SCHEMA in ../agent/subject.ts. Diagnosed root
 * cause of the live /verify failure: `response_format: { type: 'json_object' }`
 * constrains nothing but "is valid JSON" -- the model was free to invent its
 * own `kind` values, which zod's discriminated union then rejected with
 * "No matching discriminator". subject.ts already solved this exact bug class
 * (inconclusive rate 73% -> 9%) by switching to a strict `json_schema` format
 * that makes an out-of-enum value structurally impossible in the raw output,
 * not just discouraged by prompt text. Same fix, mirrored here.
 *
 * One JSON Schema variant per ClauseSchema union member in schema.ts -- kept
 * in lockstep with it by hand, the same way PLAN_JSON_SCHEMA is kept in
 * lockstep with subject.ts's own zod schema. Strict mode requires every
 * property listed in `required` and `additionalProperties: false` at every
 * object level.
 */
const CLAUSE_BASE = { id: { type: 'string' }, text: { type: 'string' } } as const;
const VAULT_ENUM = ['mmf', 'corp', 'credit', 'btc'] as const;
const MANDATE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clauses'],
  properties: {
    clauses: {
      type: 'array',
      items: {
        anyOf: [
          {
            type: 'object', additionalProperties: false,
            required: ['id', 'text', 'kind', 'vault', 'limitBps'],
            properties: {
              ...CLAUSE_BASE, kind: { type: 'string', enum: ['max_concentration'] },
              vault: { type: 'string', enum: VAULT_ENUM },
              limitBps: { type: 'integer', minimum: 0, maximum: 10_000 },
            },
          },
          {
            type: 'object', additionalProperties: false,
            required: ['id', 'text', 'kind', 'amountUsdc', 'byDays'],
            properties: {
              ...CLAUSE_BASE, kind: { type: 'string', enum: ['min_liquid'] },
              amountUsdc: { type: 'string', description: 'Decimal USDC amount as a plain string, e.g. "50000". Not base/atomic units.' },
              byDays: { type: 'integer', minimum: 0 },
            },
          },
          {
            type: 'object', additionalProperties: false,
            required: ['id', 'text', 'kind', 'vault'],
            properties: {
              ...CLAUSE_BASE, kind: { type: 'string', enum: ['prohibited_vault'] },
              vault: { type: 'string', enum: VAULT_ENUM },
            },
          },
          {
            type: 'object', additionalProperties: false,
            required: ['id', 'text', 'kind', 'days'],
            properties: {
              ...CLAUSE_BASE, kind: { type: 'string', enum: ['min_notice_cover'] },
              days: { type: 'integer', minimum: 0 },
            },
          },
          {
            type: 'object', additionalProperties: false,
            required: ['id', 'text', 'kind'],
            properties: { ...CLAUSE_BASE, kind: { type: 'string', enum: ['soft_preference'] } },
          },
        ],
      },
    },
  },
} as const;

const KNOWN_CLAUSE_KINDS = ['max_concentration', 'min_liquid', 'prohibited_vault', 'min_notice_cover', 'soft_preference'];

/**
 * Generous enough for a full clause list; mirrors MAX_OUTPUT_TOKENS in
 * subject.ts. Requirement (measured against live SERV): `max_completion_tokens`,
 * never `max_tokens` -- the latter is refused.
 */
const MAX_OUTPUT_TOKENS = 4096;

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
  const raw = JSON.parse(json);
  // Task A12, requirement 4: even with the schema constraining the live call
  // (see MANDATE_JSON_SCHEMA / compileMandate below), a dropped clause is a
  // missing constraint -- the most dangerous failure mode this product has.
  // So an out-of-enum `kind` must never come out as a silently shortened
  // clause list; catch it here, before zod's discriminated union throws its
  // own less-actionable "No matching discriminator", and name the bad value
  // and clause explicitly.
  if (raw && Array.isArray(raw.clauses)) {
    for (const c of raw.clauses) {
      if (c && typeof c === 'object' && !KNOWN_CLAUSE_KINDS.includes(c.kind)) {
        throw new Error(
          `compileMandate: model returned clause ${c.id ?? '?'} with unknown kind ${JSON.stringify(c.kind)} -- ` +
          `refusing to silently drop it. Known kinds: ${KNOWN_CLAUSE_KINDS.join(', ')}`,
        );
      }
    }
  }
  const parsed = MandateSchema.parse(raw);
  const clauses: Clause[] = parsed.clauses.map(toClause);
  return { version: '1', source, clauses };
}

/** Thin network shell: fetch a JSON string from SERV and hand it to parseMandate. */
export async function compileMandate(source: string): Promise<Mandate> {
  const res = await servClient().chat.completions.create({
    model: KRONOS_MODEL || SERV_MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      // SERV refuses a JSON response format unless the literal word "json"
      // appears in the input itself, not only in the system prompt (measured
      // against live SERV; see subject.ts's proposeServ for the same rule).
      { role: 'user', content: `${source}\n\nRespond with a single JSON object matching the schema.` },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'mandate', schema: MANDATE_JSON_SCHEMA, strict: true } },
    max_completion_tokens: MAX_OUTPUT_TOKENS,
  });
  return parseMandate(source, res.choices[0].message.content ?? '{}');
}

export const hardClauseCount = (m: Mandate): number => m.clauses.filter(isHard).length;

/** Re-exported so proposeAmendment's shell can validate against the same schema. */
export { ClauseSchema };
