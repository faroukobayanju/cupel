import { NextResponse } from 'next/server';
import { runCampaign, type ProposeFn } from '../../../core/fuzz/campaign';
import { simulatedWorld } from '../../../core/world/chain';
import { stubProposePlan } from '../../../core/agent/stub';
import { conservativeMandate } from '../../../fixtures/mandates/conservative';
import { bigintSafe } from '../../../core/json';

/**
 * Wraps the synchronous, deterministic stub agent as a ProposeFn so it can be
 * injected into runCampaign in place of the real (networked) proposePlan. This
 * route makes no network calls and needs no API key: the mandate is a hardcoded
 * fixture, the world is the simulated chain, and the subject agent is the stub.
 */
const proposeWithStub: ProposeFn = async (mandate, world) => stubProposePlan(mandate, world);

/** MINOR 5: with a real engine, a thrown SDK exception's message can carry
 *  request/response fragments -- an API key, a bearer token, an Authorization
 *  header value. Redact anything that looks like one and cap length before
 *  any thrown message leaves this route in the public JSON response. */
const MAX_THROWN_MESSAGE_LEN = 200;
const SECRET_PATTERNS = [
  /bearer\s+[a-z0-9._-]+/gi,
  /\b(sk|pk|api[_-]?key|apikey)[-_a-z0-9]*[=:\s]+[a-z0-9._-]{8,}/gi,
  /\bAuthorization\s*[:=]\s*\S+/gi,
];

function redactSecrets(message: string): string {
  let out = message;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]');
  return out;
}

function sanitizeThrownMessages(thrownMessages: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [message, count] of Object.entries(thrownMessages)) {
    const truncated = message.length > MAX_THROWN_MESSAGE_LEN
      ? `${message.slice(0, MAX_THROWN_MESSAGE_LEN)}...`
      : message;
    const safe = redactSecrets(truncated);
    out[safe] = (out[safe] ?? 0) + count;
  }
  return out;
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
    // Ruling A2-obs: so the UI (and anyone reading this JSON) can tell "the
    // model returned junk" apart from "our own checker threw on valid input"
    // instead of both collapsing into the same opaque `inconclusive` count.
    inconclusiveBreakdown: {
      ...result.inconclusiveBreakdown,
      thrownMessages: sanitizeThrownMessages(result.inconclusiveBreakdown.thrownMessages),
    },
    clauseVaults,
    firstBreach,
  };

  const responseBody = JSON.stringify(payload, bigintSafe);
  return new NextResponse(responseBody, { headers: { 'content-type': 'application/json' } });
}
