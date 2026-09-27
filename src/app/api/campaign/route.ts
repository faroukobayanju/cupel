import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { runCampaign, type ProposeFn } from '../../../core/fuzz/campaign';
import type { Engine } from '../../../core/agent/subject';
import { simulatedWorld } from '../../../core/world/chain';
import { stubProposePlan } from '../../../core/agent/stub';
import { conservativeMandate } from '../../../fixtures/mandates/conservative';
import { bigintSafe } from '../../../core/json';
import { servClient, SERV_MODEL } from '../../../core/serv';
import { redactSecrets } from '../../../core/redact';

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
 *  any thrown message leaves this route in the public JSON response.
 *  (redactSecrets itself now lives in core/redact.ts, shared with /api/verify.) */
const MAX_THROWN_MESSAGE_LEN = 200;

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

/** Spec's own campaign size (500) is an internal ceiling, not a public one --
 *  this route is unauthenticated, so the public default must be far lower.
 *  Overridable for anyone who deploys this behind their own auth/quota. */
const MAX_N = Number(process.env.CUPEL_PUBLIC_MAX_N ?? 25);
const DEFAULT_N = 20;

/** CRITICAL 1: per-IP rate limit, no new dependency. A module-scope Map is a
 *  ponytail: single global lock, not per-account/per-deploy-instance --
 *  fine for one Node process backing a hackathon demo, wrong the moment this
 *  runs behind multiple instances (upgrade path: a shared store, e.g. Redis).
 *  Expired entries are swept on every call so the Map can't grow unbounded. */
const RATE_LIMIT = Number(process.env.CUPEL_RATE_LIMIT ?? 5);
const RATE_WINDOW_MS = Number(process.env.CUPEL_RATE_WINDOW_MS ?? 10 * 60 * 1000);
const FALLBACK_IP = 'unknown';
const rateLimitState = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return FALLBACK_IP;
}

/** Returns null if the request is allowed, or the Retry-After in whole
 *  seconds if it should be rejected with 429. */
function checkRateLimit(ip: string): number | null {
  const now = Date.now();
  for (const [key, entry] of rateLimitState) {
    if (entry.resetAt <= now) rateLimitState.delete(key);
  }
  const entry = rateLimitState.get(ip);
  if (!entry || entry.resetAt <= now) {
    rateLimitState.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }
  if (entry.count >= RATE_LIMIT) {
    return Math.ceil((entry.resetAt - now) / 1000);
  }
  entry.count += 1;
  return null;
}

/** Parses `n` from the request body. Returns the resolved (clamped) n, or a
 *  ready-to-return 400 NextResponse if the caller's `n` is invalid. */
function resolveN(requestBody: unknown): { n: number } | { errorResponse: NextResponse } {
  const rawN = (requestBody as { n?: unknown } | null)?.n;
  if (rawN === undefined) return { n: DEFAULT_N };
  if (typeof rawN !== 'number' || !Number.isFinite(rawN) || rawN < 0) {
    return {
      errorResponse: NextResponse.json(
        { error: `n must be a non-negative finite number, got ${JSON.stringify(rawN)}` },
        { status: 400 },
      ),
    };
  }
  return { n: Math.min(MAX_N, Math.max(1, Math.floor(rawN))) };
}

/**
 * Task A8: default to a working engine. 'gemini' (the live, free, working
 * LLM path) when a key is configured; otherwise 'stub' (offline,
 * deterministic) rather than silently defaulting to 'serv', which -- with
 * zero credit -- would 402 on every trial. Returns the resolved ApiEngine,
 * or a ready-to-return 400 NextResponse if the caller's `engine` is invalid.
 */
function resolveEngine(requestBody: unknown): { apiEngine: ApiEngine } | { errorResponse: NextResponse } {
  const rawEngine = (requestBody as { engine?: unknown } | null)?.engine;
  if (rawEngine === undefined) {
    return { apiEngine: process.env.GEMINI_API_KEY ? 'gemini' : 'stub' };
  }
  if (typeof rawEngine === 'string' && (API_ENGINES as readonly string[]).includes(rawEngine)) {
    return { apiEngine: rawEngine as ApiEngine };
  }
  return {
    errorResponse: NextResponse.json(
      { error: `engine must be one of ${API_ENGINES.join(', ')}, got ${JSON.stringify(rawEngine)}` },
      { status: 400 },
    ),
  };
}

/** The 'serv' engine's gating + credit preflight. Returns a ready-to-return
 *  error NextResponse if 'serv' is disabled or out of credit, else null. */
async function servPreflightError(apiEngine: ApiEngine): Promise<NextResponse | null> {
  if (apiEngine !== 'serv') return null;

  if (process.env.CUPEL_ALLOW_SERV !== 'true') {
    return NextResponse.json(
      { engine: apiEngine, error: 'The "serv" engine is disabled on this deployment (spends real SERV credit). Select "gemini" or "stub" instead.' },
      { status: 403 },
    );
  }

  const creditError = await servCreditError();
  if (creditError !== null) {
    return NextResponse.json({ engine: apiEngine, error: creditError }, { status: 402 });
  }
  return null;
}

/** Shapes the campaign result into the route's public JSON payload. */
function buildPayload(result: Awaited<ReturnType<typeof runCampaign>>, apiEngine: ApiEngine) {
  const firstBreach = result.trials.find((t) => t.status === 'breach') ?? null;

  // So the UI can attribute a violated clause to the specific intent that
  // breached it (rather than guessing), without re-deriving mandate structure
  // client-side: every clause that names a vault, mapped id -> vault.
  const clauseVaults = Object.fromEntries(
    conservativeMandate.clauses.filter((c) => 'vault' in c).map((c) => [c.id, (c as { vault: string }).vault]),
  );

  return {
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
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const retryAfterSeconds = checkRateLimit(ip);
  if (retryAfterSeconds !== null) {
    return NextResponse.json(
      { error: `Rate limit exceeded (${RATE_LIMIT} requests per ${Math.round(RATE_WINDOW_MS / 60_000)} minutes). Retry after ${retryAfterSeconds}s.` },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  let requestBody: unknown = {};
  try {
    requestBody = await request.json();
  } catch {
    // No body, or non-JSON body: treat as "n omitted", not as garbage.
  }

  const nResult = resolveN(requestBody);
  if ('errorResponse' in nResult) return nResult.errorResponse;
  const { n } = nResult;

  const engineResult = resolveEngine(requestBody);
  if ('errorResponse' in engineResult) return engineResult.errorResponse;
  const { apiEngine } = engineResult;

  const preflightError = await servPreflightError(apiEngine);
  if (preflightError !== null) return preflightError;

  const result = await runCampaign({
    mandate: conservativeMandate,
    nominal: simulatedWorld(),
    n,
    seed: 'cupel-demo',
    engine: toInternalEngine(apiEngine),
    propose: apiEngine === 'stub' ? proposeWithStub : undefined,
  });

  const responseBody = JSON.stringify(buildPayload(result, apiEngine), bigintSafe);
  return new NextResponse(responseBody, { headers: { 'content-type': 'application/json' } });
}
