import { createPublicClient, http } from 'viem';
import { avalanche, bsc } from 'viem/chains';
import { ERC4626_ABI } from './chain';

/**
 * Read-only reader for IXS's real, live production vaults (BSC + Avalanche
 * mainnet). No signing, no keys, no writes — this only ever calls view
 * functions. IXS vaults are ERC-7540 (async ERC-4626); some ERC-4626 reads
 * may revert. When one does, it's caught and recorded in `unsupported`
 * rather than crashing the whole read.
 */

export const IXS_VAULTS = [
  { chain: 'bsc', address: '0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82' },
  { chain: 'avalanche', address: '0xaD01573b459805E3954398796203d830B57A8bD9' },
] as const satisfies readonly { chain: 'bsc' | 'avalanche'; address: `0x${string}` }[];

export interface IxsVaultReport {
  chain: 'bsc' | 'avalanche';
  address: `0x${string}`;
  totalAssets?: string;
  asset?: string;
  maxDeposit?: string;
  convertToAssetsPerShare?: string;
  unsupported: string[];
}

function clientFor(chain: 'bsc' | 'avalanche') {
  return createPublicClient({ chain: chain === 'bsc' ? bsc : avalanche, transport: http() });
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const ONE_SHARE = 1_000_000n; // arbitrary probe unit; only used to see if the call reverts

export async function readIxsVaults(): Promise<IxsVaultReport[]> {
  const reports: IxsVaultReport[] = [];
  for (const v of IXS_VAULTS) {
    const client = clientFor(v.chain);
    const report: IxsVaultReport = { chain: v.chain, address: v.address, unsupported: [] };

    async function tryCall<T>(fnName: string, run: () => Promise<T>): Promise<T | undefined> {
      try {
        return await run();
      } catch {
        report.unsupported.push(fnName);
        return undefined;
      }
    }

    const totalAssets = await tryCall('totalAssets', () =>
      client.readContract({ address: v.address, abi: ERC4626_ABI, functionName: 'totalAssets' }));
    if (totalAssets !== undefined) report.totalAssets = totalAssets.toString();

    const asset = await tryCall('asset', () =>
      client.readContract({ address: v.address, abi: ERC4626_ABI, functionName: 'asset' }));
    if (asset !== undefined) report.asset = asset;

    const maxDeposit = await tryCall('maxDeposit', () =>
      client.readContract({ address: v.address, abi: ERC4626_ABI, functionName: 'maxDeposit', args: [ZERO_ADDRESS] }));
    if (maxDeposit !== undefined) report.maxDeposit = maxDeposit.toString();

    const convertToAssets = await tryCall('convertToAssets', () =>
      client.readContract({ address: v.address, abi: ERC4626_ABI, functionName: 'convertToAssets', args: [ONE_SHARE] }));
    if (convertToAssets !== undefined) report.convertToAssetsPerShare = convertToAssets.toString();

    reports.push(report);
  }
  return reports;
}
