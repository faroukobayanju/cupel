import OpenAI from 'openai';

export const SERV_MODEL = 'gpt-6-luna';
/** Set only if docs/PROBES.md records R4 as live. */
export const KRONOS_MODEL = process.env.KRONOS_OK === 'true' ? `${SERV_MODEL}-serv-kronos` : SERV_MODEL;

/**
 * Task A7c benchmark model: the one model both the SERV arm and the raw arm
 * run, so the comparison isolates SERV's reasoning layer rather than model
 * choice. `gemini-2.5-flash` is confirmed live in SERV's own catalog (probed,
 * 200) and is also reachable directly and for free through Gemini's
 * OpenAI-compatible endpoint -- that's why the raw arm below points there.
 */
export const BENCH_MODEL = 'gemini-2.5-flash';

/**
 * Task A8: the `raw` (Gemini) engine's actual working model -- deliberately
 * NOT `BENCH_MODEL`. Live probing found `gemini-2.5-flash`'s free tier is
 * capped at a `generate_content_free_tier_requests` quota of 20 requests/day
 * per project per model (quotaId `GenerateRequestsPerDayPerProjectPerModel-
 * FreeTier`, confirmed via a 429 RESOURCE_EXHAUSTED body, still 429 after
 * waiting past its own stated retryDelay -- this is a real daily cap, not a
 * transient per-minute one). That quota was exhausted by this task's own
 * probing before a single fixture campaign trial ran. `gemini-2.5-flash` is
 * also now a legacy model on Google's side: newer `gemini-3.x` models are
 * what new API keys get pointed at. `gemini-3.5-flash-lite` was probed live,
 * returns 200, and held up over repeated rapid calls (10/10 finish=stop)
 * where `gemini-2.5-flash` could not. This is why the raw arm and the serv
 * arm (see compare.ts) no longer share one model -- SERV is unusable anyway
 * (zero credit, 402), so that comparison's premise is currently moot.
 */
export const GEMINI_MODEL = 'gemini-3.5-flash-lite';

export function servClient() {
  return new OpenAI({ apiKey: process.env.SERV_API_KEY!, baseURL: 'https://inference-api.openserv.ai/v1' });
}

/**
 * Task A7c: repointed from OpenAI (no credit left) to Gemini's
 * OpenAI-compatible endpoint, which is free and verified live (200). This is
 * the benchmark's raw arm; it must run BENCH_MODEL, the same model as the
 * serv arm, or the comparison would measure model choice, not SERV.
 */
export function rawClient() {
  return new OpenAI({
    apiKey: process.env.GEMINI_API_KEY!,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    // Task A8: live probing hit Gemini's free-tier RPM limit under
    // concurrency; the SDK's default retry (2, exponential backoff, honors a
    // 429's Retry-After) already helps, but a transient rate limit shouldn't
    // eat into the same inconclusive bucket as a model genuinely declining to
    // answer -- give it more attempts before it gives up and does exactly that.
    maxRetries: 5,
  });
}
