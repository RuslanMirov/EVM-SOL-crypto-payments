#!/usr/bin/env node
/**
 * scripts/sweep-evm.js
 *
 * Checks native balances (ETH, BNB, MATIC …) for HD wallet indices
 * [startIndex..endIndex] on ALL configured EVM chains.
 * If balance > 0, sweeps to treasury.
 *
 * Usage:
 *   node scripts/sweep-evm.js <startIndex> <endIndex>
 *
 * Examples:
 *   node scripts/sweep-evm.js 0 99
 *   node scripts/sweep-evm.js 5 5      # single index
 */

require('dotenv').config();

const { ethers }              = require('ethers');
const { deriveEvmKeypair }    = require('../src/services/hdWallet');
const { getProvider }         = require('../src/config/evmProvider');
const { getChainConfig, getConfiguredChainIds } = require('../src/config/chains');

const ETH_TRANSFER_GAS = 21_000n;

// ─── CLI args ────────────────────────────────────────────────────────────────

const [,, startArg, endArg] = process.argv;

if (startArg == null || endArg == null) {
  console.error('Usage: node scripts/sweep-evm.js <startIndex> <endIndex>');
  process.exit(1);
}

const startIndex = parseInt(startArg, 10);
const endIndex   = parseInt(endArg, 10);

if (Number.isNaN(startIndex) || Number.isNaN(endIndex) || startIndex < 0 || endIndex < startIndex) {
  console.error('Error: startIndex and endIndex must be non-negative integers, endIndex >= startIndex');
  process.exit(1);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const chainIds = getConfiguredChainIds();
  if (chainIds.length === 0) {
    console.error('No EVM chains configured. Set EVM_CHAIN_{id}_RPC in .env');
    process.exit(1);
  }

  console.log(`\nSweep EVM native balances — indices ${startIndex}..${endIndex}`);
  console.log(`Configured chains: ${chainIds.map(id => {
    const { name } = getChainConfig(id);
    return `${name} (${id})`;
  }).join(', ')}\n`);

  let totalSwept = 0;

  for (const chainId of chainIds) {
    const { name, base } = getChainConfig(chainId);
    const provider       = getProvider(chainId);
    const symbol         = name.includes('BNB') || chainId === 56 ? 'BNB'
                         : chainId === 137 ? 'MATIC'
                         : chainId === 43114 ? 'AVAX'
                         : 'ETH';

    console.log(`── ${name} (chain ${chainId}) ──  treasury: ${base}`);

    for (let i = startIndex; i <= endIndex; i++) {
      const { address, privateKey } = deriveEvmKeypair(i);

      let balance;
      try {
        balance = await provider.getBalance(address);
      } catch (err) {
        console.error(`  [${i}] ${address}  ERROR fetching balance: ${err.message}`);
        continue;
      }

      const balanceStr = ethers.formatEther(balance);

      if (balance === 0n) {
        console.log(`  [${i}] ${address}  balance: 0 ${symbol}`);
        continue;
      }

      console.log(`  [${i}] ${address}  balance: ${balanceStr} ${symbol}`);

      // Sweep to treasury
      try {
        const feeData  = await provider.getFeeData();
        const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
        if (!gasPrice) { console.error(`    -> could not fetch gas price, skipping`); continue; }

        const gasCost    = gasPrice * ETH_TRANSFER_GAS;
        const sendAmount = balance - gasCost;

        if (sendAmount <= 0n) {
          console.log(`    -> balance too low to cover gas (${ethers.formatEther(gasCost)} ${symbol}), skipping`);
          continue;
        }

        const wallet = new ethers.Wallet(privateKey, provider);
        const tx     = await wallet.sendTransaction({
          to: base,
          value: sendAmount,
          gasLimit: ETH_TRANSFER_GAS,
          gasPrice,
        });

        console.log(`    -> sweeping ${ethers.formatEther(sendAmount)} ${symbol}  tx: ${tx.hash}`);
        const receipt = await tx.wait(1);

        if (receipt?.status === 1) {
          console.log(`    -> confirmed`);
          totalSwept++;
        } else {
          console.error(`    -> tx reverted`);
        }
      } catch (err) {
        console.error(`    -> sweep failed: ${err.message}`);
      }
    }

    console.log();
  }

  console.log(`Done. Swept ${totalSwept} address(es).`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
