import { VAULT_IDS, type VaultId, type VaultState, type WorldState } from '../types';

/** Nominal APY and queue days. Sourced from IXS where exposed, otherwise declared simulated. */
const NOMINAL: Record<VaultId, Pick<VaultState, 'apyBps' | 'queueDays' | 'description'>> = {
  mmf: { apyBps: 400, queueDays: 1, description: 'Fidelity USD Money Market Fund' },
  corp: { apyBps: 600, queueDays: 3, description: 'BlackRock Corporate Bond' },
  credit: { apyBps: 900, queueDays: 30, description: 'Private Credit' },
  btc: { apyBps: 800, queueDays: 7, description: 'BTC Real Yield' },
};

/**
 * Live chain path (task A8). Until viem reads land, this throws unless
 * SIMULATED_CHAIN=true, in which case it delegates to simulatedWorld().
 *
 * Deliberately does NOT import viem or declare ERC4626_ABI: A8 owns both, as the
 * single source of truth for the on-chain read path.
 */
export async function readNominalWorld(_holder: `0x${string}`): Promise<WorldState> {
  if (process.env.SIMULATED_CHAIN === 'true') return simulatedWorld();
  throw new Error('live chain path not implemented until task A8; set SIMULATED_CHAIN=true');
}

export function simulatedWorld(): WorldState {
  const vaults = {} as Record<VaultId, VaultState>;
  const heldUsdc = {} as Record<VaultId, bigint>;
  for (const id of VAULT_IDS) {
    vaults[id] = { id, maxDeposit: 1_000_000_000_000n, rewardBps: 0, rewardExpiryDays: 0, ...NOMINAL[id] };
    heldUsdc[id] = 0n;
  }
  return {
    seed: 'nominal', blockNumber: 0n, simulated: true, vaults, heldUsdc,
    idleUsdc: 100_000_000_000n, liabilityUsdc: 50_000_000_000n, liabilityDays: 30,
  };
}
