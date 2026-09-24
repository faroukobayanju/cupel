/**
 * Task A7c: the raw-vs-SERV benchmark this submission's headline number
 * comes from. Runs BOTH arms over the identical mandate, model, and world
 * set (see src/core/bench/compare.ts for how identical worlds are
 * guaranteed) so a difference between them can only be attributed to
 * whether the request went through SERV's reasoning layer.
 *
 * Budget: the SERV account has ~$0.63 left, a hard cap of 15 live SERV
 * calls for this whole task. Every world in this campaign costs exactly one
 * SERV call (the raw arm is free -- it now runs against Gemini directly,
 * see src/core/serv.ts rawClient()). conservativeMandate has 3 hard clauses,
 * so seedFromClauses always contributes 3 worlds regardless of N; total SERV
 * calls = 3 + N. N=11 -> 14 SERV calls, 1 call of headroom under the cap.
 * This script must be run at most once against the live key.
 *
 * Loads .env.local with the same inline parser as scripts/live-campaign.ts
 * (no dotenv dependency; this repo takes on none). Never prints the API keys.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { compare } from '../src/core/bench/compare';
import { conservativeMandate } from '../src/fixtures/mandates/conservative';
import { simulatedWorld } from '../src/core/world/chain';
import { stringifySafe } from '../src/core/json';
import { isHard } from '../src/core/types';

const N = Number(process.env.BENCH_N ?? 11);
const SEED = process.env.BENCH_SEED ?? 'cupel-bench-a7c';

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
    `Raw arm -> Gemini directly (free). SERV arm -> ${servCallCount} live SERV calls (budget cap: 15).\n` +
    `Both arms: same mandate, same model (BENCH_MODEL), same seed ('${SEED}'), same worlds.\n`,
  );

  if (servCallCount > 15) {
    console.error(`Refusing to run: ${servCallCount} SERV calls exceeds the 15-call hard cap. Lower BENCH_N.`);
    process.exit(1);
  }

  const result = await compare(conservativeMandate, simulatedWorld(), N, SEED);

  writeFileSync('src/fixtures/bench-result.json', stringifySafe(result, 2));

  console.log('=== RAW vs SERV BENCHMARK (n =', N, 'sampled worlds per arm, +', hardClauseCount, 'clause-seed worlds) ===');
  console.log(
    `STATISTICAL CAVEAT: n=${N + hardClauseCount} trials per arm. At this sample size, no result below is\n` +
    `statistically significant -- treat every rate as a disclosed point estimate, not a proven effect.\n`,
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
    console.log('claim, but not significant at this sample size -- do not report this as proof.');
  } else if (gap > 0) {
    console.log(`SERV breach rate is HIGHER than raw by ${pct(gap)} at n=${N + hardClauseCount}. This is the opposite of the claim.`);
    console.log('Reporting this honestly, as instructed: raw beat SERV in this run.');
  } else {
    console.log(`NULL RESULT: raw and SERV breach rates are identical (${pct(result.rawBreachRate)}) at n=${N + hardClauseCount}.`);
    console.log('This is a real, publishable finding at this sample size, not a failure to find an effect worth hiding.');
  }

  console.log('\nWritten: src/fixtures/bench-result.json (full trial data for both arms, replayable by /verify without re-spending).');
}

main().catch((e) => {
  console.error('bench failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
