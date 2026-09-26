import { createPublicClient, http, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';
import { VAULT_IDS, type VaultId, type VaultState, type WorldState, type Usdc } from '../types';

/**
 * Minimal ERC-4626 read ABI. Single source of truth: nothing else in this
 * repo may redeclare it (see IXS reader in ixs.ts, which imports this).
 */
export const ERC4626_ABI = [
  {
    type: 'function', name: 'maxDeposit', stateMutability: 'view',
    inputs: [{ name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'previewDeposit', stateMutability: 'view',
    inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'convertToAssets', stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'totalAssets', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'asset', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'address' }],
  },
] as const;

/** Nominal APY and queue days. Sourced from IXS where exposed, otherwise declared simulated. */
const NOMINAL: Record<VaultId, Pick<VaultState, 'apyBps' | 'queueDays' | 'description'>> = {
  mmf: { apyBps: 400, queueDays: 1, description: 'Fidelity USD Money Market Fund' },
  corp: { apyBps: 600, queueDays: 3, description: 'BlackRock Corporate Bond' },
  credit: { apyBps: 900, queueDays: 30, description: 'Private Credit' },
  btc: { apyBps: 800, queueDays: 7, description: 'BTC Real Yield' },
};

/**
 * Live chain path. Reads Cupel's own deployed ERC-4626 (Base Sepolia,
 * CUPEL_VAULT_ADDRESS) for maxDeposit/previewDeposit/convertToAssets/balanceOf.
 *
 * ponytail: only one real vault is deployed for the hackathon, so its live
 * numbers stand in for all four VaultIds (apyBps/queueDays/description stay
 * the declared NOMINAL values — those aren't on-chain fields on a plain
 * ERC-4626 anyway). The one real position is attributed to `mmf`. Upgrade:
 * deploy per-vault contracts and drop this fan-out once VAULT_MMF/CORP/
 * CREDIT/BTC addresses exist.
 */
export async function readNominalWorld(holder: `0x${string}`): Promise<WorldState> {
  if (process.env.SIMULATED_CHAIN === 'true') return simulatedWorld();

  const rpcUrl = process.env.BASE_SEPOLIA_RPC;
  const vaultAddress = process.env.CUPEL_VAULT_ADDRESS as Address | undefined;
  if (!rpcUrl) throw new Error('BASE_SEPOLIA_RPC not set');
  if (!vaultAddress) throw new Error('CUPEL_VAULT_ADDRESS not set');

  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

  const [maxDep, shareBalance, blockNumber] = await Promise.all([
    client.readContract({ address: vaultAddress, abi: ERC4626_ABI, functionName: 'maxDeposit', args: [holder] }),
    client.readContract({ address: vaultAddress, abi: ERC4626_ABI, functionName: 'balanceOf', args: [holder] }),
    client.getBlockNumber(),
  ]);
  const heldAssets = await client.readContract({
    address: vaultAddress, abi: ERC4626_ABI, functionName: 'convertToAssets', args: [shareBalance],
  });

  const vaults = {} as Record<VaultId, VaultState>;
  const heldUsdc = {} as Record<VaultId, Usdc>;
  for (const id of VAULT_IDS) {
    vaults[id] = { id, maxDeposit: maxDep as Usdc, rewardBps: 0, rewardExpiryDays: 0, ...NOMINAL[id] };
    heldUsdc[id] = 0n;
  }
  heldUsdc.mmf = heldAssets as Usdc;

  return {
    seed: 'chain', blockNumber, simulated: false, vaults, heldUsdc,
    // Not sourced from an ERC-4626 read (no standard field for either) — left
    // at zero rather than fabricated. Upgrade: source from a real liability book.
    idleUsdc: 0n, liabilityUsdc: 0n, liabilityDays: 0,
  };
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
