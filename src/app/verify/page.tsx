'use client';

import { useEffect, useState } from 'react';
import { BottomNav } from '../_components/BottomNav';

interface VerifyCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail';
  detail: string;
  value?: unknown;
  links?: { label: string; url: string }[];
}

interface VerifyResponse {
  ranAt: string;
  checks: VerifyCheck[];
  allPassed: boolean;
}

const BASESCAN_TX = /^0x[0-9a-fA-F]{64}$/;

function withBasescanLinks(check: VerifyCheck): VerifyCheck {
  if (check.links && check.links.length > 0) return check;
  const value = check.value;
  if (!value || typeof value !== 'object') return check;
  const links: { label: string; url: string }[] = [];
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && BASESCAN_TX.test(v)) {
      links.push({ label: key, url: `https://sepolia.basescan.org/tx/${v}` });
    }
  }
  return links.length > 0 ? { ...check, links } : check;
}

/**
 * Wallet-free, key-free verification page: every check here re-runs live,
 * on load, against the real chain / SERV / the frozen benchmark fixture.
 * There is no cached "last known good" state -- a reload is a fresh check.
 */
export default function VerifyPage() {
  const [data, setData] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/verify');
      const body: VerifyResponse = await res.json();
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run();
  }, []);

  return (
    <div className="flex min-h-screen flex-col pb-[calc(var(--nav-height)+var(--space-8))]">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 pt-16 sm:px-6">
        <section className="relative -mx-4 flex flex-col gap-4 px-4 pb-8 pt-4 sm:-mx-6 sm:px-6">
          <div className="grid-backdrop pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="relative flex flex-col gap-4">
            <span className="font-label label-caps tag-angle text-[var(--color-accent)] text-xs">verify</span>
            <h1 className="font-display text-3xl text-[var(--color-ink)] sm:text-[var(--text-3xl)]">
              Nothing here is asserted.
            </h1>
            <p className="font-label max-w-md text-[var(--color-ink-2)] text-xs">
              Every check below re-runs live, right now, against real infrastructure — no wallet
              and no API key needed to view this page. A check that cannot run reports an explicit
              failure and why, never a silent pass.
            </p>
          </div>
        </section>

        {error && (
          <p
            role="alert"
            className="border border-[var(--color-breach)] bg-[var(--color-paper-2)] px-4 py-3 text-sm text-[var(--color-breach)]"
          >
            could not reach /api/verify: {error}
          </p>
        )}

        {loading && !data && (
          <p className="font-label text-xs text-[var(--color-ink-2)]" aria-live="polite">
            running live checks…
          </p>
        )}

        {data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border border-[var(--color-rule)] bg-[var(--color-paper-2)] p-4">
              <span className="font-label text-xs text-[var(--color-ink-2)]">
                ran at {data.ranAt}
              </span>
              <span
                className={
                  'font-label label-caps border px-2 py-1 text-xs ' +
                  (data.allPassed
                    ? 'border-[var(--color-clean)] text-[var(--color-clean)]'
                    : 'border-[var(--color-breach)] text-[var(--color-breach)]')
                }
              >
                {data.allPassed ? 'all checks passed' : 'one or more checks failed'}
              </span>
            </div>
            <section className="flex flex-col gap-3">
              {data.checks.map((c) => (
                <CheckCard key={c.id} check={withBasescanLinks(c)} />
              ))}
            </section>
          </>
        )}
      </main>

      <BottomNav active="verify" primaryLabel={loading ? 'checking…' : 're-run'} onPrimary={run} primaryDisabled={loading} />
    </div>
  );
}

function CheckCard({ check }: { check: VerifyCheck }) {
  const pass = check.status === 'pass';
  return (
    <div
      className={
        'flex flex-col gap-3 border p-4 ' +
        (pass ? 'border-[var(--color-rule)] bg-[var(--color-paper-2)]' : 'border-[var(--color-breach)] bg-[var(--color-paper-2)]')
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--color-ink)]">{check.label}</h2>
        <span
          className={
            'font-label label-caps shrink-0 border px-2 py-0.5 text-xs ' +
            (pass
              ? 'border-[var(--color-clean)] text-[var(--color-clean)]'
              : 'border-[var(--color-breach)] text-[var(--color-breach)]')
          }
        >
          {check.status}
        </span>
      </div>
      <p className="text-sm text-[var(--color-ink-2)]">{check.detail}</p>
      {check.links && check.links.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {check.links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="font-label label-caps text-xs text-[var(--color-accent)] underline decoration-1 underline-offset-4 hover:opacity-80"
            >
              {l.label} ↗
            </a>
          ))}
        </div>
      )}
      {check.value !== undefined && (
        <details className="text-xs">
          <summary className="font-label label-caps cursor-pointer text-[var(--color-ink-2)]">raw value</summary>
          <pre className="mt-2 overflow-x-auto border border-[var(--color-rule)] bg-[var(--color-paper-3)] p-3 text-[var(--color-ink)]">
            {JSON.stringify(check.value, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
