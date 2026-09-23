import { NextResponse } from 'next/server';
import { runCampaign, type ProposeFn } from '../../../core/fuzz/campaign';
import { simulatedWorld } from '../../../core/world/chain';
import { stubProposePlan } from '../../../core/agent/stub';
import { conservativeMandate } from '../../../fixtures/mandates/conservative';

/**
 * Wraps the synchronous, deterministic stub agent as a ProposeFn so it can be
 * injected into runCampaign in place of the real (networked) proposePlan. This
 * route makes no network calls and needs no API key: the mandate is a hardcoded
 * fixture, the world is the simulated chain, and the subject agent is the stub.
 */
const proposeWithStub: ProposeFn = async (mandate, world) => stubProposePlan(mandate, world);

/** JSON.stringify throws on bigint; this replacer converts every bigint to a string instead. */
function bigintSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** Spec's own campaign size; also the ceiling so a public route can't be made to
 *  allocate and evaluate an unbounded number of worlds in one request. */
const MAX_N = 500;
const DEFAULT_N = 40;

export async function POST(request: Request) {
  let requestBody: unknown = {};
  try {
    requestBody = await request.json();
  } catch {
    // No body, or non-JSON body: treat as "n omitted", not as garbage.
  }

  const rawN = (requestBody as { n?: unknown } | null)?.n;
  let n = DEFAULT_N;
  if (rawN !== undefined) {
    if (typeof rawN !== 'number' || !Number.isFinite(rawN) || rawN < 0) {
      return NextResponse.json(
        { error: `n must be a non-negative finite number, got ${JSON.stringify(rawN)}` },
        { status: 400 },
      );
    }
    n = Math.min(MAX_N, Math.max(1, Math.floor(rawN)));
  }

  const result = await runCampaign({
    mandate: conservativeMandate,
    nominal: simulatedWorld(),
    n,
    seed: 'cupel-demo',
    engine: 'serv',
    propose: proposeWithStub,
  });

  const firstBreach = result.trials.find((t) => t.status === 'breach') ?? null;

  // So the UI can attribute a violated clause to the specific intent that
  // breached it (rather than guessing), without re-deriving mandate structure
  // client-side: every clause that names a vault, mapped id -> vault.
  const clauseVaults = Object.fromEntries(
    conservativeMandate.clauses.filter((c) => 'vault' in c).map((c) => [c.id, (c as { vault: string }).vault]),
  );

  const payload = {
    counted: result.counted,
    breaches: result.breaches,
    inconclusive: result.inconclusive,
    breachRate: result.breachRate,
    hardClauses: result.hardClauses,
    breachesByClauseId: result.breachesByClauseId,
    clauseVaults,
    firstBreach,
  };

  const responseBody = JSON.stringify(payload, bigintSafe);
  return new NextResponse(responseBody, { headers: { 'content-type': 'application/json' } });
}
