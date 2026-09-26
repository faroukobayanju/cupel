/**
 * Task A10: replay-able record of the on-chain layer. Run once after deploy
 * + deposit; writes src/fixtures/chain-facts.json. Reads only — never signs,
 * never touches BURNER_PRIVATE_KEY. `/verify` replays this file later.
 */
import { writeFileSync } from 'node:fs';
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { readIxsVaults } from '../src/core/world/ixs';

const DEPLOY_TX = '0x08ded29dd27df5c7dec2716fb9e5cc11f698abc7065ff84e77e9493a4d669f2a';
const DEPOSIT_TX = '0xd7c50617b9f2e863a9c65038eef9773c7b560c57806fe47ac2914a2d902d7208';
const APPROVE_TX = '0x6b47ea6ba24a2fac540f1e3378afb7de84f3b46131303987209e17f8ed56d8ed';
const VAULT_ADDRESS = process.env.CUPEL_VAULT_ADDRESS ?? '0x4DB33a6E6B5174f7048b66AEC15c22264dE19098';
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const RPC_URL = process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org';

async function main() {
  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

  const [deployReceipt, approveReceipt, depositReceipt] = await Promise.all([
    client.getTransactionReceipt({ hash: DEPLOY_TX }),
    client.getTransactionReceipt({ hash: APPROVE_TX }),
    client.getTransactionReceipt({ hash: DEPOSIT_TX }),
  ]);

  const ixsReports = await readIxsVaults();

  const facts = {
    network: 'base-sepolia',
    chainId: 84532,
    underlyingAsset: USDC_ADDRESS,
    deployedVault: {
      address: VAULT_ADDRESS,
      deployTxHash: DEPLOY_TX,
      deployBlockNumber: deployReceipt.blockNumber.toString(),
      status: deployReceipt.status,
    },
    approve: {
      txHash: APPROVE_TX,
      blockNumber: approveReceipt.blockNumber.toString(),
      status: approveReceipt.status,
      amount: '1000000',
    },
    deposit: {
      txHash: DEPOSIT_TX,
      blockNumber: depositReceipt.blockNumber.toString(),
      status: depositReceipt.status,
      assetsIn: '1000000',
      sharesOut: '1000000',
    },
    ixsProductionReads: {
      note: 'Read-only reads of IXS live production vaults (Avalanche + BSC mainnet). ' +
        'IXS is ERC-7540 (async ERC-4626); calls that reverted are listed per-vault in `unsupported`.',
      readAt: new Date().toISOString(),
      vaults: ixsReports,
    },
  };

  writeFileSync('src/fixtures/chain-facts.json', JSON.stringify(facts, null, 2) + '\n');
  console.log('wrote src/fixtures/chain-facts.json');
}

main().catch((e) => {
  console.error('record-chain-facts failed:', e.message);
  process.exit(1);
});
