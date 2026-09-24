/**
 * Task A7a: prove the real agent works end to end against the live SERV key.
 *
 * Loads .env.local (no dotenv dependency -- a minimal inline parser, since
 * this repo takes on no new dependencies), builds the fixture mandate, and
 * runs a REAL campaign through proposePlan with engine: 'serv'. n=8 by
 * design: this spends real credit from a $5 balance (~$0.005 at this size).
 *
 * Never prints the API key.
 */
import { existsSync, readFileSync } from 'node:fs';
import { runCampaign } from '../src/core/fuzz/campaign';
import { localizeByClause, localizeByNode } from '../src/core/fuzz/localize';
import { conservativeMandate } from '../src/fixtures/mandates/conservative';
import { simulatedWorld } from '../src/core/world/chain';
import { stringifySafe } from '../src/core/json';

function loadEnvLocal(path = '.env.local') {
  if (!existsSync(path)) {
    console.error(`${path} not found -- cannot load SERV_API_KEY.`);
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
  if (!process.env.SERV_API_KEY) {
    console.error('SERV_API_KEY not set after loading .env.local.');
    process.exit(1);
  }

  console.log('Running a real campaign against SERV (engine: serv, n=8)...\n');

  const result = await runCampaign({
    mandate: conservativeMandate,
    nominal: simulatedWorld(),
    n: 8,
    seed: 'live-campaign-a7a',
    engine: 'serv',
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
  const passingTrial = result.trials.find((t) => t.status === 'clean');

  console.log('\n=== ONE FULL BREACHING TRIAL ===');
  if (!breachingTrial) {
    console.log('(none -- no trial breached the mandate in this run)');
  } else {
    console.log(stringifySafe(breachingTrial, 2));

    console.log('\n=== LOCALIZATION: by clause (reasoning-summary diff, falls back to rationale) ===');
    console.log(stringifySafe(localizeByClause(breachingTrial, passingTrial), 2));

    console.log('\n=== LOCALIZATION: by node (real reasoning id, when present) ===');
    console.log(stringifySafe(localizeByNode(breachingTrial, breachingTrial.plan?.reasoningId), 2));
  }
}

main().catch((e) => {
  console.error('live-campaign failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
