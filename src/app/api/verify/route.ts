import { createPublicClient, http, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';
import { NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { ERC4626_ABI } from '../../../core/world/chain';
import { readIxsVaults } from '../../../core/world/ixs';
import { replayArm, type JsonArm } from '../../../core/verify/replay';
import { compileMandate } from '../../../core/mandate/compile';
import { SERV_MODEL, KRONOS_MODEL } from '../../../core/serv';
import chainFacts from '../../../fixtures/chain-facts.json';
import benchResult from '../../../fixtures/bench-result.json';

/**
 * TASK A11: every claim in the README that can be checked live, checked live,
 * on every request. No check here is allowed to report a hardcoded pass --
 * each one either runs the real read/replay and reports what it actually
 * got, or reports an explicit failure naming why it couldn't run (missing
 * env var, network error, etc). See docs/superpowers/specs/2026-09-23-cupel-design.md
 * section 8b for why IXS is read-only production data and Base Sepolia is a
 * reference vault, not an IXS deployment.
 */

export interface VerifyCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail';
  detail: string;
  value?: unknown;
  links?: { label: string; url: string }[];
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const BASESCAN = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;

function basePublicClient() {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC || 'https://base-sepolia.drpc.org';
  return createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
}

async function checkVaultReads(): Promise<VerifyCheck> {
  const vaultAddress = chainFacts.deployedVault.address as Address;
  try {
    const client = basePublicClient();
    const [maxDeposit, totalAssets, asset, blockNumber] = await Promise.all([
      client.readContract({ address: vaultAddress, abi: ERC4626_ABI, functionName: 'maxDeposit', args: [ZERO_ADDRESS] }),
      client.readContract({ address: vaultAddress, abi: ERC4626_ABI, functionName: 'totalAssets' }),
      client.readContract({ address: vaultAddress, abi: ERC4626_ABI, functionName: 'asset' }),
      client.getBlockNumber(),
    ]);
    return {
      id: 'base-sepolia-vault-reads',
      label: 'Base Sepolia: live reads against the deployed vault',
      status: 'pass',
      detail: `Read maxDeposit, totalAssets, and asset from ${vaultAddress} at current block ${blockNumber}.`,
      value: {
        vaultAddress, currentBlock: blockNumber.toString(),
        maxDeposit: maxDeposit.toString(), totalAssets: totalAssets.toString(), asset,
      },
      links: [{ label: 'View vault on Basescan', url: `https://sepolia.basescan.org/address/${vaultAddress}` }],
    };
  } catch (err) {
    return {
      id: 'base-sepolia-vault-reads',
      label: 'Base Sepolia: live reads against the deployed vault',
      status: 'fail',
      detail: `Read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkReceipt(
  id: string, label: string, txHash: `0x${string}`,
): Promise<VerifyCheck> {
  try {
    const client = basePublicClient();
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    const pass = receipt.status === 'success';
    return {
      id, label,
      status: pass ? 'pass' : 'fail',
      detail: pass
        ? `Receipt status "${receipt.status}" at block ${receipt.blockNumber}.`
        : `Receipt status "${receipt.status}" -- expected "success".`,
      value: { txHash, status: receipt.status, blockNumber: receipt.blockNumber.toString() },
      links: [{ label: 'View on Basescan', url: BASESCAN(txHash) }],
    };
  } catch (err) {
    return {
      id, label, status: 'fail',
      detail: `Could not fetch receipt: ${err instanceof Error ? err.message : String(err)}`,
      links: [{ label: 'View on Basescan', url: BASESCAN(txHash) }],
    };
  }
}

async function checkIxsReads(): Promise<VerifyCheck> {
  try {
    const reports = await readIxsVaults();
    const allReadable = reports.every((r) => r.totalAssets !== undefined);
    return {
      id: 'ixs-production-reads',
      label: 'IXS: read-only reads of their live production vaults (BSC + Avalanche)',
      status: allReadable ? 'pass' : 'fail',
      detail: allReadable
        ? 'totalAssets read successfully from both production vaults.'
        : 'One or more vaults failed to return totalAssets -- see value.unsupported.',
      value: reports,
    };
  } catch (err) {
    return {
      id: 'ixs-production-reads', label: 'IXS: read-only reads of their live production vaults (BSC + Avalanche)',
      status: 'fail', detail: `Read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function checkBenchmarkReplay(): VerifyCheck {
  try {
    const { raw, serv } = benchResult as unknown as { raw: JsonArm; serv: JsonArm };
    const rawReplay = replayArm(raw);
    const servReplay = replayArm(serv);
    const pass = rawReplay.matches && servReplay.matches;
    return {
      id: 'benchmark-replay',
      label: 'Frozen benchmark: replayed through the real checker, not just read from JSON',
      status: pass ? 'pass' : 'fail',
      detail: pass
        ? `Re-running checkPlan over every stored (world, plan) pair reproduces the recorded counts: ` +
          `raw ${rawReplay.recomputedBreaches}/${rawReplay.recomputedCounted} breaches, serv ${servReplay.recomputedBreaches}/${servReplay.recomputedCounted}.`
        : 'Recomputed breach counts do not match the numbers recorded in bench-result.json.',
      value: { raw: rawReplay, serv: servReplay },
    };
  } catch (err) {
    return {
      id: 'benchmark-replay', label: 'Frozen benchmark: replayed through the real checker, not just read from JSON',
      status: 'fail', detail: `Replay failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkMandateCompile(): Promise<VerifyCheck> {
  const id = 'mandate-compile-replay';
  const label = 'Mandate compile: live SERV call, English policy -> typed clauses';
  if (!process.env.SERV_API_KEY) {
    return { id, label, status: 'fail', detail: 'SERV_API_KEY is not set -- cannot make a live compile call.' };
  }
  try {
    const source = readFileSync('src/fixtures/mandates/conservative.txt', 'utf8');
    const mandate = await compileMandate(source);
    const pass = mandate.clauses.length > 0;
    return {
      id, label,
      status: pass ? 'pass' : 'fail',
      detail: pass
        ? `Compiled ${mandate.clauses.length} clauses from the English policy using ${KRONOS_MODEL || SERV_MODEL}.`
        : 'Compile call returned zero clauses.',
      value: { model: KRONOS_MODEL || SERV_MODEL, clauseCount: mandate.clauses.length, clauseIds: mandate.clauses.map((c) => c.id) },
    };
  } catch (err) {
    return { id, label, status: 'fail', detail: `Compile call failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function GET() {
  const checks = await Promise.all([
    checkVaultReads(),
    checkReceipt('deploy-tx-receipt', 'Base Sepolia: deploy transaction receipt', chainFacts.deployedVault.deployTxHash as `0x${string}`),
    checkReceipt('deposit-tx-receipt', 'Base Sepolia: deposit transaction receipt', chainFacts.deposit.txHash as `0x${string}`),
    checkIxsReads(),
    Promise.resolve(checkBenchmarkReplay()),
    checkMandateCompile(),
  ]);

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    checks,
    allPassed: checks.every((c) => c.status === 'pass'),
  });
}
