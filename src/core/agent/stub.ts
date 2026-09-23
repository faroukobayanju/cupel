import { VAULT_IDS, type AllocationPlan, type Mandate, type WorldState } from '../types';

/**
 * Beyond this many days in a vault's redemption queue, the stub treats the vault
 * as fully illiquid and holds the rest of idle cash back rather than commit it.
 * A plain "don't lock up cash for more than about three weeks" heuristic — it
 * knows nothing about the mandate, only about the chosen vault's own queueDays.
 */
const ILLIQUIDITY_HORIZON_DAYS = 20;

/** Base units (6 decimals) to a human-readable dollar string, for rationale text only. */
const usd = (n: bigint): string => `$${(Number(n) / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/**
 * A deterministic, naively greedy stub agent. It stands in for the real
 * `proposePlan` (task subject.ts) so the fuzz loop can run with no network and no
 * API key. It is deliberately not clever: it looks at total yield
 * (apyBps + rewardBps) per vault, and dumps most of idle USDC into whichever vault
 * looks most attractive right now — exactly the kind of naive behavior a mandate's
 * concentration cap exists to catch. It does not know about the mandate's caps; it
 * only cites clause ids that plausibly relate to the vault it picked, the way a
 * shallow LLM agent might cite a clause without actually enforcing it.
 *
 * Same world in, same plan out: no randomness, no Date.now(), no external state.
 */
export function stubProposePlan(mandate: Mandate, world: WorldState): AllocationPlan {
  const best = VAULT_IDS.reduce((a, b) =>
    world.vaults[b].apyBps + world.vaults[b].rewardBps > world.vaults[a].apyBps + world.vaults[a].rewardBps ? b : a
  );

  // Buffer = enough cash to cover the known near-term liability, plus a
  // liquidity cushion that grows with how long the chosen vault takes to
  // redeem. A vault that pays out same-day gets treated aggressively (cushion
  // ~0); a vault that locks cash up for weeks gets treated cautiously (cushion
  // grows toward the full remaining balance). This is ordinary cash-management
  // caution a naive developer would write without ever reading the mandate —
  // it reasons about the world's own liabilityUsdc/queueDays fields, not about
  // any clause.
  const queueDays = world.vaults[best].queueDays;
  const cappedQueueDays = BigInt(Math.min(queueDays, ILLIQUIDITY_HORIZON_DAYS));
  const discretionary = world.idleUsdc > world.liabilityUsdc ? world.idleUsdc - world.liabilityUsdc : 0n;
  const illiquidityCushion = (discretionary * cappedQueueDays) / BigInt(ILLIQUIDITY_HORIZON_DAYS);
  const buffer = world.liabilityUsdc + illiquidityCushion;
  const amount = world.idleUsdc - buffer;

  // Cite any clause that mentions the chosen vault, plus any soft_preference
  // clause — a naive agent reaches for whatever looks relevant, whether or not it
  // actually complies.
  const citesClauseIds = mandate.clauses
    .filter((c) => ('vault' in c && c.vault === best) || c.kind === 'soft_preference')
    .map((c) => c.id);

  if (amount <= 0n) {
    return { intents: [], rationale: `no idle USDC to deploy; holding position` };
  }

  return {
    intents: [{ kind: 'deposit', vault: best, amount, citesClauseIds }],
    rationale: `${best} offers the highest yield (${world.vaults[best].apyBps + world.vaults[best].rewardBps}bps combined apy+reward); allocating idle cash there, holding back ${usd(buffer)} for the known liability and the vault's ${queueDays}-day redemption queue`,
  };
}
