'use client';

import { useEffect, useState } from 'react';

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
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col gap-8 py-16 px-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Verify
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Every check below runs live, right now, against real infrastructure --
            no wallet and no API key needed to view this page. A check that cannot
            run reports an explicit failure and why, never a silent pass.
          </p>
          <button
            onClick={run}
            disabled={loading}
            className="mt-2 w-fit rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {loading ? 'Re-checking…' : 'Re-run all checks'}
          </button>
        </header>

        {error && (
          <p className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            Could not reach /api/verify: {error}
          </p>
        )}

        {loading && !data && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Running live checks…</p>
        )}

        {data && (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Ran at {data.ranAt} --{' '}
              <strong className={data.allPassed ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>
                {data.allPassed ? 'all checks passed' : 'one or more checks failed'}
              </strong>
            </p>
            <section className="flex flex-col gap-4">
              {data.checks.map((c) => (
                <CheckCard key={c.id} check={c} />
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function CheckCard({ check }: { check: VerifyCheck }) {
  const pass = check.status === 'pass';
  return (
    <div
      className={
        'flex flex-col gap-2 rounded-lg border p-4 ' +
        (pass
          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
          : 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30')
      }
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium text-black dark:text-zinc-50">{check.label}</h2>
        <span
          className={
            'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ' +
            (pass
              ? 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-200'
              : 'bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-200')
          }
        >
          {check.status}
        </span>
      </div>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{check.detail}</p>
      {check.links && check.links.length > 0 && (
        <div className="flex gap-3">
          {check.links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-blue-700 underline dark:text-blue-400"
            >
              {l.label} ↗
            </a>
          ))}
        </div>
      )}
      {check.value !== undefined && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-500 dark:text-zinc-400">Raw value</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-zinc-900 p-2 text-zinc-100 dark:bg-black">
            {JSON.stringify(check.value, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
