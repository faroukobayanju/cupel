/**
 * Task A9: the raw-vs-SERV benchmark this submission's headline number comes
 * from. Runs BOTH arms over the identical mandate, model, and world set (see
 * src/core/bench/compare.ts for how identical worlds are guaranteed) so a
 * difference between them can only be attributed to whether the request went
 * through SERV.
 *
 * CORRECTED FACTS (task A9, superseding the A7c/A8 comments below and in
 * serv.ts): SERV is NOT out of credit -- it returns 200 live. Its cost is NOT
 * ~$0.03/call; a real response showed 196 prompt + 8 completion tokens, which
 * at gpt-6-luna catalog rates ($0.13 / $0.65 per M tokens) is ~$0.00003 per
 * call, ~$0.0008 for a campaign-sized call. Budget is not the constraint here
 * -- honesty and identical arms are. The hard SERV-call cap below is raised
 * accordingly, but this script still refuses to run an unbounded N, and still
 * prints real token usage and real cost rather than assuming a number.
 *
 * THE KEY FACT A8 MISSED: SERV's Responses API rejects Gemini models (400
 * "The Responses API is not supported with model gemini-2.5-flash", verified
 * live) -- but SERV's chat/completions endpoint accepts Gemini (verified 200,
 * model echoed back). So the SERV arm below does NOT go through
 * proposeServ/proposePlan's 'serv' engine (that stays on Responses +
 * gpt-6-luna, unmodified, for the demo's reasoning-capture feature). Instead
 * this script injects its own `propose` (both arms) into `compare()`/
 * `runCampaign`, exactly the injection point those functions already expose
 * for testing:
 *   - raw arm  -> proposePlan(..., 'raw')   -- unchanged, chat/completions,
 *                 gemini-3.5-flash-lite, direct against Gemini, free.
 *   - serv arm -> proposeServViaChat(...)   -- NEW, chat/completions, the
 *                 SAME gemini-3.5-flash-lite model, through SERV.
 * Same system prompt, same JSON schema, same lenient fenced-JSON parsing on
 * both (see src/core/agent/subject.ts: both call the same proposeChatCompletion
 * helper). The only difference between the two arms is the base URL/client.
 *
 * Loads .env.local with the same inline parser as scripts/live-campaign.ts
 * (no dotenv dependency; this repo takes on none). Never prints the API keys.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { compare } from '../src/core/bench/compare';
import type { ProposeFn } from '../src/core/fuzz/campaign';
import { proposePlan, proposeServViaChat } from '../src/core/agent/subject';
import { conservativeMandate } from '../src/fixtures/mandates/conservative';
import { simulatedWorld } from '../src/core/world/chain';
import { stringifySafe } from '../src/core/json';
import { isHard } from '../src/core/types';

const N = Number(process.env.BENCH_N ?? 40);
const SEED = process.env.BENCH_SEED ?? 'cupel-bench-a9';

/**
 * Task A9: raised from 15 (a hard cap set under the now-disproven belief that
 * SERV had ~$0.63 left). Real measured cost is ~$0.0008/call, so even a
 * generous N here is a few cents -- this cap now exists only to stop a typo'd
 * BENCH_N from spending an unbounded amount unattended, not to protect a
 * nearly-empty balance.
 */
const SERV_CALL_CAP = 200;

/** gemini-3.5-flash-lite catalog rate through SERV, USD per token. Filled in
 *  from the live run's own printed SERV_CATALOG_RATE env override if the
 *  operator has one; otherwise this script reports token totals honestly and
 *  computes cost at the same $0.13/$0.65-per-million-token rate the corrected
 *  facts used for gpt-6-luna, clearly labeled as an assumption, not a
 *  confirmed gemini-3.5-flash-lite catalog rate (SERV's own catalog listing
 *  does not expose per-model pricing -- see scripts/probe.ts/probe2.ts). */
const ASSUMED_PROMPT_RATE_PER_M = Number(process.env.SERV_PROMPT_RATE_PER_M ?? 0.13);
const ASSUMED_COMPLETION_RATE_PER_M = Number(process.env.SERV_COMPLETION_RATE_PER_M ?? 0.65);

function loadEnvLocal(path = '.env.local') {
  if (!existsSync(path)) {
    console.error(`${path} not found -- cannot load SERV_API_KEY / GEMINI_API_KEY.`);
    process.exit(1);
  }
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

async function main() {
  loadEnvLocal();
  if (!process.env.SERV_API_KEY) {
    console.error('SERV_API_KEY not set after loading .env.local.');
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not set after loading .env.local.');
    process.exit(1);
  }

  const hardClauseCount = conservativeMandate.clauses.filter(isHard).length;
  const servCallCount = hardClauseCount + N;
  console.log(
    `Running raw-vs-SERV benchmark. n=${N} sampled worlds + ${hardClauseCount} clause-seed worlds per arm.\n` +
    `Raw arm  -> Gemini directly (free), gemini-3.5-flash-lite.\n` +
    `SERV arm -> ${servCallCount} live SERV calls, chat/completions, SAME model (gemini-3.5-flash-lite).\n` +
    `Both arms: same mandate, same seed ('${SEED}'), same worlds -- only the transport differs.\n`,
  );

  if (servCallCount > SERV_CALL_CAP) {
    console.error(`Refusing to run: ${servCallCount} SERV calls exceeds the ${SERV_CALL_CAP}-call cap. Lower BENCH_N.`);
    process.exit(1);
  }

  // Task A9: token usage totals for the SERV arm only, accumulated as the
  // injected propose function is called by runCampaign's pool. Mutated from
  // inside the closure below rather than threaded through ProposeFn's return
  // type, since AllocationPlan (and therefore CampaignResult/Comparison) has
  // no slot for per-call usage and adding one would touch every consumer of
  // that type for a number only this script needs.
  let servPromptTokens = 0;
  let servCompletionTokens = 0;
  let servCallsWithUsage = 0;
  let servCallsMissingUsage = 0;

  const livePropose: ProposeFn = async (mandate, world, engine) => {
    if (engine === 'raw') {
      // Unchanged real path: proposePlan(..., 'raw') already does exactly
      // what the raw arm needs (chat/completions, gemini-3.5-flash-lite,
      // direct against Gemini) and already self-catches to 'inconclusive'.
      return proposePlan(mandate, world, 'raw');
    }
    // 'serv' arm: chat/completions through SERV, not the Responses-API
    // proposeServ path (see this file's header comment for why).
    const { result, usage } = await proposeServViaChat(mandate, world);
    if (usage) {
      servPromptTokens += usage.promptTokens;
      servCompletionTokens += usage.completionTokens;
      servCallsWithUsage += 1;
    } else {
      servCallsMissingUsage += 1;
    }
    return result;
  };

  const result = await compare(conservativeMandate, simulatedWorld(), N, SEED, livePropose);

  writeFileSync('src/fixtures/bench-result.json', stringifySafe(result, 2));

  console.log('=== RAW vs SERV BENCHMARK (n =', N, 'sampled worlds per arm, +', hardClauseCount, 'clause-seed worlds) ===');
  console.log(
    `STATISTICAL CAVEAT: n=${N + hardClauseCount} trials per arm. At this sample size, a difference of a few\n` +
    `points between arms is noise, not a proven effect -- treat every rate below as a disclosed point\n` +
    `estimate, not statistical significance.\n`,
  );
  console.log('counted (min of both arms) :', result.counted);
  console.log('raw  breach rate  :', pct(result.rawBreachRate), `(${result.raw.breaches}/${result.raw.counted} counted, ${result.raw.inconclusive} inconclusive)`);
  console.log('serv breach rate  :', pct(result.servBreachRate), `(${result.serv.breaches}/${result.serv.counted} counted, ${result.serv.inconclusive} inconclusive)`);

  console.log('\n--- raw inconclusive breakdown ---');
  console.log('agentInconclusive:', result.raw.inconclusiveBreakdown.agentInconclusive, ' threw:', result.raw.inconclusiveBreakdown.threw);
  if (Object.keys(result.raw.inconclusiveBreakdown.thrownMessages).length) {
    console.log('thrownMessages:', stringifySafe(result.raw.inconclusiveBreakdown.thrownMessages, 2));
  }

  console.log('\n--- serv inconclusive breakdown ---');
  console.log('agentInconclusive:', result.serv.inconclusiveBreakdown.agentInconclusive, ' threw:', result.serv.inconclusiveBreakdown.threw);
  if (Object.keys(result.serv.inconclusiveBreakdown.thrownMessages).length) {
    console.log('thrownMessages:', stringifySafe(result.serv.inconclusiveBreakdown.thrownMessages, 2));
  }

  console.log('\n--- per-clause breach counts (raw) ---');
  console.log(stringifySafe(result.raw.breachesByClauseId, 2));
  console.log('\n--- per-clause breach counts (serv) ---');
  console.log(stringifySafe(result.serv.breachesByClauseId, 2));

  const gap = result.servBreachRate - result.rawBreachRate;
  console.log('\n--- verdict ---');
  if (gap < 0) {
    console.log(`SERV breach rate is LOWER than raw by ${pct(-gap)} at n=${N + hardClauseCount}. Directionally consistent with the`);
    console.log('claim, but NOT statistically significant at this sample size -- do not report this as proof.');
  } else if (gap > 0) {
    console.log(`SERV breach rate is HIGHER than raw by ${pct(gap)} at n=${N + hardClauseCount}. This is the opposite of the claim.`);
    console.log('Reporting this honestly, as instructed: raw beat SERV in this run.');
  } else {
    console.log(`NULL RESULT: raw and SERV breach rates are identical (${pct(result.rawBreachRate)}) at n=${N + hardClauseCount}.`);
    console.log('This is a real, publishable finding at this sample size, not a failure to find an effect worth hiding.');
  }

  const totalServTokens = servPromptTokens + servCompletionTokens;
  const cost = (servPromptTokens / 1_000_000) * ASSUMED_PROMPT_RATE_PER_M
    + (servCompletionTokens / 1_000_000) * ASSUMED_COMPLETION_RATE_PER_M;
  console.log('\n--- SERV arm real token usage & cost ---');
  console.log('calls with usage reported   :', servCallsWithUsage);
  console.log('calls missing usage         :', servCallsMissingUsage, servCallsMissingUsage > 0 ? '(provider omitted `usage`; not counted below)' : '');
  console.log('prompt tokens (sum)         :', servPromptTokens);
  console.log('completion tokens (sum)     :', servCompletionTokens);
  console.log('total tokens (sum)          :', totalServTokens);
  console.log(
    `assumed rate ($/M tokens)   : ${ASSUMED_PROMPT_RATE_PER_M} prompt / ${ASSUMED_COMPLETION_RATE_PER_M} completion ` +
    `(gpt-6-luna's published catalog rate -- SERV's catalog listing does not expose a per-model rate for ` +
    `gemini-3.5-flash-lite, so this is the same rate the corrected task brief used, not a confirmed number for this model)`,
  );
  console.log(`computed cost               : $${cost.toFixed(6)}`);

  console.log('\nWritten: src/fixtures/bench-result.json (full trial data for both arms, replayable by /verify without re-spending).');
}

main().catch((e) => {
  console.error('bench failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
