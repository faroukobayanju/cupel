'use client';

import Link from 'next/link';

/**
 * Structural signature from the studied reference: a full-width segmented
 * strip pinned to the bottom of the viewport, equal-width hairline-divided
 * cells, one active in accent blue, one dark slab cell reserved for the
 * page's own primary action. On narrow widths it scrolls horizontally
 * rather than wrapping or overlapping page content.
 */
export function BottomNav({
  active,
  primaryLabel,
  onPrimary,
  primaryDisabled,
}: {
  active: 'campaign' | 'verify';
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex h-[var(--nav-height)] overflow-x-auto border-t border-[var(--color-rule)] bg-[var(--color-paper-2)]"
      aria-label="Primary"
    >
      <Link
        href="/"
        aria-current={active === 'campaign' ? 'page' : undefined}
        className={
          'flex min-w-[120px] flex-1 items-center justify-center px-4 font-label label-caps text-xs border-r border-[var(--color-rule)] ' +
          (active === 'campaign'
            ? 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
            : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink)] hover:bg-[var(--color-paper-3)]')
        }
      >
        campaign
      </Link>
      <Link
        href="/verify"
        aria-current={active === 'verify' ? 'page' : undefined}
        className={
          'flex min-w-[120px] flex-1 items-center justify-center px-4 font-label label-caps text-xs border-r border-[var(--color-rule)] ' +
          (active === 'verify'
            ? 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
            : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink)] hover:bg-[var(--color-paper-3)]')
        }
      >
        verify
      </Link>
      <button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled}
        className="flex min-w-[140px] flex-1 items-center justify-center gap-2 bg-[var(--color-ink)] px-4 font-label label-caps text-xs text-[var(--color-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {primaryLabel}
      </button>
    </nav>
  );
}
