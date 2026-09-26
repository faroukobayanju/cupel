import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { runCampaign, type ProposeFn } from '../../../core/fuzz/campaign';
import type { Engine } from '../../../core/agent/subject';
import { simulatedWorld } from '../../../core/world/chain';
import { stubProposePlan } from '../../../core/agent/stub';
import { conservativeMandate } from '../../../fixtures/mandates/conservative';
import { bigintSafe } from '../../../core/json';
import { servClient, SERV_MODEL } from '../../../core/serv';

/**
 * Wraps the synchronous, deterministic stub agent as a ProposeFn so it can be
 * injected into runCampaign in place of the real (networked) proposePlan. This
 * route makes no network calls and needs no API key: the mandate is a hardcoded
 * fixture, the world is the simulated chain, and the subject agent is the stub.
 */
const proposeWithStub: ProposeFn = async (mandate, world) => stubProposePlan(mandate, world);

/**
 * Task A8: the user-facing engine names. 'gemini' maps to the internal
 * 'raw' Engine value (see agent/subject.ts) -- the internal name stays 'raw'
 * because it's baked into bench/compare.ts's raw-vs-serv comparison, but
 * nobody choosing an engine for a demo run should have to know that history.
 */
type ApiEngine = 'stub' | 'gemini' | 'serv';
const API_ENGINES: readonly ApiEngine[] = ['stub', 'gemini', 'serv'];

function toInternalEngine(api: ApiEngine): Engine {
  return api === 'gemini' ? 'raw' : api;
}

/**
 * Task A8: if SERV has no credit left, every real call 402s. Left alone,
 * that 402 is caught by proposePlan's own blanket try/catch (subject.ts) and
 * downgraded to a plain 'inconclusive' -- indistinguishable, from the API
 * response alone, from a model that declined to answer. A whole campaign of
 * "every trial inconclusive" silently masquerading as an exhausted SERV
 * account is exactly the failure this guard exists to prevent. So: one cheap
 * preflight call before running any trials, and if it 402s, refuse the whole
 * request with an explicit, visible error instead of a campaign result that
 * quietly hides the real cause.
 *
 * IMPORTANT (found live while building this): `servClient().models.list()`
 * is NOT a valid preflight for this -- it returned 200 (empty catalog)
 * regardless of account credit, because listing models apparently doesn't
 * touch billing at all. The only call observed to reflect credit state is a
 * real completion, so this mirrors proposeServ's actual Responses-API call
 * shape (minimal `max_output_tokens`) rather than a free/unrelated endpoint.
 * This does spend a small amount of real SERV credit on every 'serv'
 * selection, which is the honest cost of actually checking. Also found live,
 * contradicting this task's stated premise: at the time this was probed, the
 * SERV account was NOT out of credit -- a real gpt-6-luna Responses-API call
 * with a system prompt succeeded (200). This guard is retained regardless,
 * since the account's credit state can change and the task's requirement
 * (never let a 402 masquerade as inconclusive) holds independent of today's
 * balance.
 */
async function servCreditError(): Promise<string | null> {
  try {
    await servClient().responses.create({
      model: SERV_MODEL,
      instructions: 'You are a terse assistant.',
      input: 'Reply with the single word: ok',
      max_output_tokens: 16,
    });
    return null;
  } catch (err) {
    if (err instanceof OpenAI.APIError && err.status === 402) {
      return 'SERV engine selected, but the SERV account has no credit left (402 from SERV). ' +
        'Select engine "gemini" or "stub" instead.';
    }
    // Any other preflight failure (network, auth, etc.) is not the specific
    // credit case this guard exists for -- let the campaign itself run and
    // report those trials as inconclusive the normal way, rather than
    // guessing at a cause here.
    return null;
  }
}

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

  // Task A8: default to a working engine. 'gemini' (the live, free, working
  // LLM path) when a key is configured; otherwise 'stub' (offline,
  // deterministic) rather than silently defaulting to 'serv', which -- with
  // zero credit -- would 402 on every trial.
  const rawEngine = (requestBody as { engine?: unknown } | null)?.engine;
  let apiEngine: ApiEngine;
  if (rawEngine === undefined) {
    apiEngine = process.env.GEMINI_API_KEY ? 'gemini' : 'stub';
  } else if (typeof rawEngine === 'string' && (API_ENGINES as readonly string[]).includes(rawEngine)) {
    apiEngine = rawEngine as ApiEngine;
  } else {
    return NextResponse.json(
      { error: `engine must be one of ${API_ENGINES.join(', ')}, got ${JSON.stringify(rawEngine)}` },
      { status: 400 },
    );
  }

  if (apiEngine === 'serv') {
    const creditError = await servCreditError();
    if (creditError !== null) {
      return NextResponse.json({ engine: apiEngine, error: creditError }, { status: 402 });
    }
  }

  const result = await runCampaign({
    mandate: conservativeMandate,
    nominal: simulatedWorld(),
    n,
    seed: 'cupel-demo',
    engine: toInternalEngine(apiEngine),
    propose: apiEngine === 'stub' ? proposeWithStub : undefined,
  });

  const firstBreach = result.trials.find((t) => t.status === 'breach') ?? null;

  // So the UI can attribute a violated clause to the specific intent that
  // breached it (rather than guessing), without re-deriving mandate structure
  // client-side: every clause that names a vault, mapped id -> vault.
  const clauseVaults = Object.fromEntries(
    conservativeMandate.clauses.filter((c) => 'vault' in c).map((c) => [c.id, (c as { vault: string }).vault]),
  );

  const payload = {
    // Task A8 honesty rail: every result carries the engine that produced it.
    // A stub run must never be presentable as an LLM result -- this is the
    // one field the UI needs to enforce that, and it names the same value
    // the caller chose (or the one that was defaulted), not the internal
    // 'raw'/'serv'/'stub' Engine value.
    engine: apiEngine,
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
