/**
 * Task A8: prove the real agent works end to end against the live, free
 * Gemini path (engine: 'raw' / GEMINI_MODEL in serv.ts) now that SERV has
 * zero credit and every SERV call 402s. Loads .env.local with the same
 * inline parser live-campaign.ts uses (no dotenv dependency), builds the
 * fixture mandate, and runs a REAL campaign through proposePlan with
 * engine: 'raw'.
 *
 * Never prints the API key.
 */
import { existsSync, readFileSync } from 'node:fs';
import { runCampaign } from '../src/core/fuzz/campaign';
import { conservativeMandate } from '../src/fixtures/mandates/conservative';
import { simulatedWorld } from '../src/core/world/chain';
import { stringifySafe } from '../src/core/json';

function loadEnvLocal(path = '.env.local') {
  if (!existsSync(path)) {
    console.error(`${path} not found -- cannot load GEMINI_API_KEY.`);
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

async function main() {
  loadEnvLocal();
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not set after loading .env.local.');
    process.exit(1);
  }

  const n = Number(process.env.LIVE_N ?? 20);
  console.log(`Running a real campaign against Gemini (engine: raw, n=${n})...\n`);

  const result = await runCampaign({
    mandate: conservativeMandate,
    nominal: simulatedWorld(),
    n,
    seed: 'live-campaign-gemini-a8',
    engine: 'raw',
  });

  console.log('=== CAMPAIGN RESULT ===');
  console.log('total trials  :', result.trials.length);
  console.log('counted       :', result.counted);
  console.log('breaches      :', result.breaches);
  console.log('inconclusive  :', result.inconclusive);
  console.log('breachRate    :', result.breachRate);
  console.log('breachesByClauseId:', stringifySafe(result.breachesByClauseId));

  console.log('\n=== INCONCLUSIVE BREAKDOWN ===');
  console.log('agentInconclusive:', result.inconclusiveBreakdown.agentInconclusive);
  console.log('threw            :', result.inconclusiveBreakdown.threw);
  console.log('thrownMessages   :', stringifySafe(result.inconclusiveBreakdown.thrownMessages, 2));

  const breachingTrial = result.trials.find((t) => t.status === 'breach');
  console.log('\n=== ONE FULL BREACHING TRIAL ===');
  if (!breachingTrial) {
    console.log('(none -- no trial breached the mandate in this run)');
  } else {
    console.log(stringifySafe(breachingTrial, 2));
  }
}

main().catch((e) => {
  console.error('live-campaign-gemini failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
