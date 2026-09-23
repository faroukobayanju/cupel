import { VAULT_IDS, type AllocationPlan, type Mandate, type WorldState } from '../types';

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

  // Keep a small liquidity buffer (10%) idle; naive greed still leaves crumbs
  // uninvested, which is realistic and also means min_liquid clauses aren't
  // trivially satisfied by accident.
  const buffer = world.idleUsdc / 10n;
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
    rationale: `${best} offers the highest yield (${world.vaults[best].apyBps + world.vaults[best].rewardBps}bps combined apy+reward); allocating idle cash there, keeping a small buffer`,
  };
}
