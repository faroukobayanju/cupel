'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BottomNav } from './_components/BottomNav';

type VaultId = 'mmf' | 'corp' | 'credit' | 'btc';
type ApiEngine = 'stub' | 'gemini' | 'serv';

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
  engine: ApiEngine;
  counted: number;
  breaches: number;
  inconclusive: number;
  breachRate: number;
  hardClauses: number;
  breachesByClauseId: Record<string, number>;
  clauseVaults: Record<string, VaultId>;
  firstBreach: TrialJson | null;
}

const VAULT_LABELS: Record<VaultId, string> = {
  mmf: 'Money Market Fund',
  corp: 'Corporate Bond',
  credit: 'Private Credit',
  btc: 'BTC Real Yield',
};

const VAULT_VAR: Record<VaultId, string> = {
  mmf: 'var(--color-vault-mmf)',
  corp: 'var(--color-vault-corp)',
  credit: 'var(--color-vault-credit)',
  btc: 'var(--color-vault-btc)',
};

const ENGINE_NOTE: Record<ApiEngine, string> = {
  stub: 'deterministic, no LLM, no network calls',
  gemini: 'live LLM, network calls',
  serv: 'live LLM via SERV, network calls',
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

// Mirrors the public route's default ceiling (src/app/api/campaign/route.ts's
// MAX_N, itself CUPEL_PUBLIC_MAX_N ?? 25). The route re-clamps server-side
// regardless -- this is only so the input doesn't invite a value the server
// will silently clamp anyway.
const PUBLIC_MAX_N = 25;

export default function Home() {
  const [engine, setEngine] = useState<ApiEngine>('stub');
  const [n, setN] = useState(20);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CampaignResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function runCampaignClick() {
    setRunning(true);
    setError(null);
    setResult(null);
    setElapsedMs(0);
    const startedAt = Date.now();
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 100);
    try {
      const res = await fetch('/api/campaign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ n, engine }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail = body && typeof body.error === 'string' ? body.error : `request failed: ${res.status}`;
        // 403 (engine disabled) and 429 (rate limited) are expected, named
        // failure modes on a public route, not generic errors -- prefix them
        // so they read as such rather than as "something broke".
        const prefix = res.status === 403 ? 'engine not available: ' : res.status === 429 ? 'rate limited: ' : '';
        throw new Error(prefix + detail);
      }
      const data: CampaignResponse = await res.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setRunning(false);
    }
  }

  const breach = result?.firstBreach;
  const breachedIntent = breach?.plan?.intents.find((i) =>
    breach.violations.some((v) => v.clauseId !== null && result?.clauseVaults[v.clauseId] === i.vault)
  ) ?? breach?.plan?.intents[0];

  const treasuryTotal = breach
    ? (Object.keys(breach.world.heldUsdc) as VaultId[])
        .reduce((sum, v) => sum + BigInt(breach.world.heldUsdc[v]), BigInt(breach.world.idleUsdc))
    : null;
  const idleAfterPlan = breach
    ? (breach.plan?.intents ?? []).reduce(
        (idle, i) => (i.kind === 'deposit' ? idle - BigInt(i.amount) : idle + BigInt(i.amount)),
        BigInt(breach.world.idleUsdc),
      )
    : null;

  // Estimated-only: the API has no streaming progress, so this ticks against
  // elapsed wall time rather than a server-confirmed trial count. Labelled
  // "~" and "estimated" throughout so it's never mistaken for a real count.
  const estimatedTrial = running ? Math.min(n, Math.floor(elapsedMs / 900) + 1) : 0;

  return (
    <div className="flex min-h-screen flex-col pb-[calc(var(--nav-height)+var(--space-8))]">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-16 px-4 pt-16 sm:px-6">
        {/* Hero */}
        <section className="relative -mx-4 flex flex-col gap-6 px-4 pb-10 pt-4 sm:-mx-6 sm:px-6">
          <div className="grid-backdrop pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="relative flex flex-col gap-4 text-left">
            <span className="font-label label-caps tag-angle text-[var(--color-accent)] text-xs">cupel</span>
            <h1 className="font-display text-[var(--text-display)] text-[var(--color-ink)]">
              Your agent breaks.
              <br />
              Find out where.
            </h1>
            <p className="font-label max-w-md text-[var(--color-ink-2)] text-xs">
              Cupel fuzzes an AI treasury agent&apos;s mandate: it searches market states for
              breaches, shrinks each one to a minimal counterexample, and certifies mandates that
              survive.
            </p>
          </div>
        </section>

        {/* Control row */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-label label-caps text-xs text-[var(--color-ink-2)]">
              engine in use:{' '}
              <strong
                className={
                  'font-mono normal-case ' +
                  (engine === 'stub' ? 'text-[var(--color-warn)]' : 'text-[var(--color-accent)]')
                }
              >
                {engine}
              </strong>
            </span>
            <fieldset className="flex border border-[var(--color-rule)]" disabled={running}>
              {(['stub', 'gemini', 'serv'] as ApiEngine[]).map((e) => (
                <label
                  key={e}
                  className={
                    'font-label label-caps cursor-pointer border-r border-[var(--color-rule)] px-3 py-2 text-xs last:border-r-0 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-[var(--color-accent)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 ' +
                    (engine === e
                      ? 'bg-[var(--color-ink)] text-[var(--color-paper)]'
                      : 'text-[var(--color-ink-2)] hover:bg-[var(--color-paper-3)]')
                  }
                >
                  <input
                    type="radio"
                    name="engine"
                    value={e}
                    checked={engine === e}
                    onChange={() => setEngine(e)}
                    className="sr-only"
                  />
                  {e}
                </label>
              ))}
            </fieldset>
          </div>

          <div className="flex items-stretch border border-[var(--color-rule)]">
            <label className="flex flex-1 items-center gap-3 px-4 py-3">
              <span className="font-label label-caps text-xs text-[var(--color-ink-2)]">n</span>
              <input
                type="number"
                min={1}
                max={PUBLIC_MAX_N}
                value={n}
                onChange={(e) => setN(Math.min(PUBLIC_MAX_N, Math.max(1, Number(e.target.value) || 1)))}
                disabled={running}
                aria-label="Number of trials"
                className="tabular w-20 border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-2 py-1 text-sm text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-50"
              />
            </label>
            <button
              type="button"
              onClick={runCampaignClick}
              disabled={running}
              className="flex items-center gap-2 border-l border-[var(--color-rule)] bg-[var(--color-ink)] px-6 py-3 font-label label-caps text-xs text-[var(--color-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running ? 'running…' : 'run'}
            </button>
            <span
              aria-hidden="true"
              className="flex w-14 items-center justify-center bg-[var(--color-accent)] text-[var(--color-accent-ink)]"
            >
              →
            </span>
          </div>
        </section>

        {/* Live progress */}
        {running && (
          <section
            className="flex flex-col gap-3 border border-[var(--color-rule)] bg-[var(--color-paper-2)] p-5"
            aria-live="polite"
          >
            <div className="flex items-center justify-between">
              <span className="font-label label-caps text-xs text-[var(--color-ink-2)]">
                phase: sampling worlds &amp; checking plans
              </span>
              <span className="font-label label-caps tabular text-xs text-[var(--color-ink-2)]">
                ~{estimatedTrial}/{n} trials (estimated)
              </span>
            </div>
            <div className="h-1.5 w-full bg-[var(--color-paper-3)]">
              <div
                className="h-full bg-[var(--color-accent)] transition-[width] duration-300 ease-out"
                style={{ width: `${Math.min(100, (estimatedTrial / n) * 100)}%`, animation: 'pulse-bar 1.6s ease-in-out infinite' }}
              />
            </div>
            <p className="font-label text-xs text-[var(--color-ink-2)]">
              a {n}-trial run against a real model can take over a minute — this bar tracks elapsed
              time, not a server-confirmed count.
            </p>
          </section>
        )}

        {error && (
          <p
            role="alert"
            className="border border-[var(--color-breach)] bg-[var(--color-paper-2)] px-4 py-3 text-sm text-[var(--color-breach)]"
          >
            {error}
          </p>
        )}

        {result && (
          <section className="flex flex-col gap-12">
            {/* Result headline */}
            <div className="flex flex-col gap-4">
              <p className="font-label text-xs text-[var(--color-ink-2)]">
                engine:{' '}
                <strong
                  className={
                    'font-mono normal-case ' +
                    (result.engine === 'stub' ? 'text-[var(--color-warn)]' : 'text-[var(--color-accent)]')
                  }
                >
                  {result.engine}
                </strong>{' '}
                — {ENGINE_NOTE[result.engine]}
              </p>
              <div className="grid grid-cols-2 gap-px border border-[var(--color-rule)] bg-[var(--color-rule)] sm:grid-cols-4">
                <Stat label="counted" value={result.counted} />
                <Stat label="breaches" value={result.breaches} tone="breach" />
                <Stat label="inconclusive" value={result.inconclusive} tone="warn" />
                <Stat label="breach rate" value={`${(result.breachRate * 100).toFixed(1)}%`} tone="breach" />
              </div>
            </div>

            {/* Per-clause breakdown */}
            <div className="flex flex-col gap-2">
              <h2 className="font-label label-caps text-xs text-[var(--color-ink-2)]">per-clause breakdown</h2>
              <div className="border border-[var(--color-rule)]">
                {Object.entries(result.breachesByClauseId).map(([clauseId, count], idx) => (
                  <div
                    key={clauseId}
                    className={
                      'flex items-center justify-between px-4 py-2.5 ' +
                      (idx > 0 ? 'border-t border-[var(--color-rule)]' : '')
                    }
                  >
                    <span className="font-mono text-sm text-[var(--color-ink)]">{clauseId}</span>
                    <span
                      className={
                        'tabular font-mono text-sm ' +
                        (count === 0 ? 'text-[var(--color-ink-2)]' : 'text-[var(--color-breach)]')
                      }
                    >
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Counterexample card — centrepiece */}
            {breach ? (
              <div className="flex flex-col gap-6 border border-[var(--color-breach)] bg-[var(--color-paper-2)] p-5 sm:p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-display text-xl text-[var(--color-breach)]">
                    Minimal breaching world
                  </h2>
                  <span className="font-label text-xs text-[var(--color-ink-2)]">
                    seed {breach.world.seed}
                  </span>
                </div>
                <span className="font-label w-fit border border-[var(--color-warn)] px-2 py-1 text-xs text-[var(--color-warn)]">
                  simulated portfolio — IXS has no testnet, these vault states are not live chain data
                </span>

                {treasuryTotal !== null && idleAfterPlan !== null && (
                  <p className="tabular text-sm text-[var(--color-ink)]">
                    treasury total <strong>{formatUsdc(treasuryTotal.toString())}</strong>, of which{' '}
                    <strong>{formatUsdc(idleAfterPlan.toString())}</strong> idle after this plan
                    {' '}(
                    {treasuryTotal > 0n
                      ? `${((Number(idleAfterPlan) / Number(treasuryTotal)) * 100).toFixed(1)}%`
                      : '—'}
                    ).
                  </p>
                )}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(Object.keys(breach.world.vaults) as VaultId[]).map((v) => (
                    <div key={v} className="flex flex-col gap-1 border border-[var(--color-rule)] p-3">
                      <span
                        className="font-label label-caps text-xs"
                        style={{ color: VAULT_VAR[v] }}
                      >
                        {VAULT_LABELS[v]}
                      </span>
                      <span className="tabular font-mono text-lg text-[var(--color-ink)]">
                        {(breach.world.vaults[v].apyBps / 100).toFixed(2)}%
                      </span>
                      <span className="font-label text-xs text-[var(--color-ink-2)]">
                        queue {breach.world.vaults[v].queueDays}d
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col gap-2">
                  <h3 className="font-label label-caps text-xs text-[var(--color-ink-2)]">breached clause(s)</h3>
                  <ul className="flex flex-col gap-1.5">
                    {breach.violations.map((v, idx) => (
                      <li key={idx} className="text-sm text-[var(--color-ink)]">
                        <span className="font-mono text-[var(--color-breach)]">
                          {v.clauseId ?? '(unexecutable)'}
                        </span>
                        {': '}
                        {v.detail}
                        {v.observedBps !== undefined && v.limitBps !== undefined && (
                          <span className="tabular text-[var(--color-ink-2)]">
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
                  <div className="flex flex-col gap-2 border-t border-[var(--color-rule)] pt-4">
                    <h3 className="font-label label-caps text-xs text-[var(--color-ink-2)]">offending intent</h3>
                    <p className="text-sm text-[var(--color-ink)]">
                      {breachedIntent.kind} {formatUsdc(breachedIntent.amount)} into{' '}
                      {VAULT_LABELS[breachedIntent.vault]}, citing{' '}
                      {breachedIntent.citesClauseIds.length > 0
                        ? breachedIntent.citesClauseIds.join(', ')
                        : '(no clauses)'}
                    </p>
                    {breach.plan?.rationale && (
                      <p className="border-l-2 border-[var(--color-rule)] pl-3 text-sm text-[var(--color-ink-2)]">
                        &ldquo;{breach.plan.rationale}&rdquo;
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="font-label text-xs text-[var(--color-ink-2)]">
                no breach found in this run — try increasing n.
              </p>
            )}
          </section>
        )}

        {/* Footer */}
        <footer className="flex flex-col gap-2 border-t border-[var(--color-rule)] py-8">
          <Link
            href="/verify"
            className="font-label label-caps w-fit text-sm text-[var(--color-accent)] underline decoration-1 underline-offset-4 hover:opacity-80"
          >
            see the evidence — every figure here re-checked live →
          </Link>
        </footer>
      </main>

      <BottomNav active="campaign" primaryLabel={running ? 'running…' : 'run'} onPrimary={runCampaignClick} primaryDisabled={running} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'breach' | 'warn' }) {
  const color =
    tone === 'breach' ? 'text-[var(--color-breach)]' : tone === 'warn' ? 'text-[var(--color-warn)]' : 'text-[var(--color-ink)]';
  return (
    <div className="flex flex-col gap-1 bg-[var(--color-paper-2)] p-4">
      <span className="font-label label-caps text-xs text-[var(--color-ink-2)]">{label}</span>
      <span className={'tabular font-mono text-2xl sm:text-3xl ' + color}>{value}</span>
    </div>
  );
}
