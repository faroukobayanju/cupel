'use client';

import { useState } from 'react';

type VaultId = 'mmf' | 'corp' | 'credit' | 'btc';

interface VaultStateJson {
  id: VaultId;
  apyBps: number;
  maxDeposit: string;
  queueDays: number;
  rewardBps: number;
  rewardExpiryDays: number;
  description: string;
}

interface WorldStateJson {
  seed: string;
  blockNumber: string;
  simulated: boolean;
  vaults: Record<VaultId, VaultStateJson>;
  idleUsdc: string;
  heldUsdc: Record<VaultId, string>;
  liabilityUsdc: string;
  liabilityDays: number;
}

interface IntentJson {
  kind: 'deposit' | 'redeem';
  vault: VaultId;
  amount: string;
  citesClauseIds: string[];
}

interface ViolationJson {
  kind: 'mandate_breach' | 'unexecutable';
  clauseId: string | null;
  detail: string;
  observedBps?: number;
  limitBps?: number;
}

interface TrialJson {
  world: WorldStateJson;
  origin: 'clause-seed' | 'sample';
  status: 'clean' | 'breach' | 'inconclusive';
  plan: { intents: IntentJson[]; rationale: string } | null;
  violations: ViolationJson[];
}

interface CampaignResponse {
  counted: number;
  breaches: number;
  inconclusive: number;
  breachRate: number;
  hardClauses: number;
  firstBreach: TrialJson | null;
}

const VAULT_LABELS: Record<VaultId, string> = {
  mmf: 'Money Market Fund',
  corp: 'Corporate Bond',
  credit: 'Private Credit',
  btc: 'BTC Real Yield',
};

/** Human-readable USDC. Base units are bigint-as-string, 6 decimals. Display only. */
function formatUsdc(baseUnits: string): string {
  const n = BigInt(baseUnits);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  const wholeStr = whole.toLocaleString('en-US');
  return `${negative ? '-' : ''}$${wholeStr}.${frac}`;
}

export default function Home() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CampaignResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(40);

  async function runCampaignClick() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/campaign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ n }),
      });
      if (!res.ok) throw new Error(`request failed: ${res.status}`);
      const data: CampaignResponse = await res.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setRunning(false);
    }
  }

  const breach = result?.firstBreach;
  const breachedIntent = breach?.plan?.intents.find((i) =>
    breach.violations.some((v) => i.citesClauseIds.includes(v.clauseId ?? '__none__') || v.kind === 'mandate_breach')
  ) ?? breach?.plan?.intents[0];

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col gap-8 py-16 px-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Cupel
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Fuzzes an AI treasury agent against ERC-4626 RWA vaults, looking for
            mandate breaches. Running on{' '}
            <strong className="font-medium text-black dark:text-zinc-200">
              simulated chain data
            </strong>{' '}
            — no network calls, no live vaults.
          </p>
        </header>

        <section className="flex items-center gap-4">
          <button
            onClick={runCampaignClick}
            disabled={running}
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {running ? 'Running…' : 'Run campaign'}
          </button>
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            trials
            <input
              type="number"
              min={1}
              value={n}
              onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))}
              disabled={running}
              className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </label>
          {running && (
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              sampling worlds and checking plans…
            </span>
          )}
        </section>

        {error && (
          <p className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        {result && (
          <section className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="counted" value={result.counted} />
              <Stat label="breaches" value={result.breaches} tone="bad" />
              <Stat label="inconclusive" value={result.inconclusive} />
              <Stat label="breach rate" value={`${(result.breachRate * 100).toFixed(1)}%`} tone="bad" />
            </div>

            {breach ? (
              <div className="flex flex-col gap-4 rounded-lg border border-red-300 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/40">
                <h2 className="text-lg font-semibold text-red-900 dark:text-red-200">
                  First breaching trial ({breach.world.seed})
                </h2>

                <div>
                  <h3 className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Vault APYs in this world
                  </h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-zinc-500 dark:text-zinc-400">
                        <th className="pr-4 font-normal">Vault</th>
                        <th className="pr-4 font-normal">APY</th>
                        <th className="pr-4 font-normal">Reward</th>
                        <th className="font-normal">Queue days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(breach.world.vaults) as VaultId[]).map((v) => (
                        <tr key={v} className="border-t border-zinc-200 dark:border-zinc-800">
                          <td className="py-1 pr-4 text-black dark:text-zinc-50">
                            {VAULT_LABELS[v]}
                          </td>
                          <td className="pr-4 text-black dark:text-zinc-50">
                            {(breach.world.vaults[v].apyBps / 100).toFixed(2)}%
                          </td>
                          <td className="pr-4 text-black dark:text-zinc-50">
                            {(breach.world.vaults[v].rewardBps / 100).toFixed(2)}%
                          </td>
                          <td className="text-black dark:text-zinc-50">
                            {breach.world.vaults[v].queueDays}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h3 className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Breached clause(s)
                  </h3>
                  <ul className="flex flex-col gap-1 text-sm">
                    {breach.violations.map((v, idx) => (
                      <li key={idx} className="text-red-800 dark:text-red-300">
                        <span className="font-mono text-xs">{v.clauseId ?? '(unexecutable)'}</span>
                        {': '}
                        {v.detail}
                        {v.observedBps !== undefined && v.limitBps !== undefined && (
                          <span className="text-zinc-500 dark:text-zinc-400">
                            {' '}
                            (observed {(v.observedBps / 100).toFixed(2)}%, limit{' '}
                            {(v.limitBps / 100).toFixed(2)}%)
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                {breachedIntent && (
                  <div>
                    <h3 className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Offending intent
                    </h3>
                    <p className="text-sm text-black dark:text-zinc-50">
                      {breachedIntent.kind} {formatUsdc(breachedIntent.amount)} into{' '}
                      {VAULT_LABELS[breachedIntent.vault]}, citing{' '}
                      {breachedIntent.citesClauseIds.length > 0
                        ? breachedIntent.citesClauseIds.join(', ')
                        : '(no clauses)'}
                    </p>
                    {breach.plan?.rationale && (
                      <p className="mt-1 text-sm italic text-zinc-600 dark:text-zinc-400">
                        &ldquo;{breach.plan.rationale}&rdquo;
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No breach found in this run. Try increasing the trial count.
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'bad' }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <span className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span
        className={`text-2xl font-semibold ${
          tone === 'bad' ? 'text-red-700 dark:text-red-400' : 'text-black dark:text-zinc-50'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
