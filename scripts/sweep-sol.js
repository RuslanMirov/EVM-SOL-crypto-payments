#!/usr/bin/env node
/**
 * scripts/sweep-sol.js
 *
 * Checks native SOL balances for HD wallet indices [startIndex..endIndex].
 * If balance > 0, sweeps to treasury.
 *
 * Usage:
 *   node scripts/sweep-sol.js <startIndex> <endIndex>
 *
 * Examples:
 *   node scripts/sweep-sol.js 0 99
 *   node scripts/sweep-sol.js 5 5      # single index
 */

require('dotenv').config();

const {
  PublicKey, Transaction, SystemProgram,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const { deriveSolKeypair }              = require('../src/services/hdWallet');
const { getConnection, getSolTreasury } = require('../src/config/solProvider');

const FEE_BUFFER_LAMPORTS = 5_000n;

// ─── CLI args ────────────────────────────────────────────────────────────────

const [,, startArg, endArg] = process.argv;

if (startArg == null || endArg == null) {
  console.error('Usage: node scripts/sweep-sol.js <startIndex> <endIndex>');
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
  const connection  = getConnection();
  const treasuryStr = getSolTreasury();
  const treasuryPub = new PublicKey(treasuryStr);

  console.log(`\nSweep SOL native balances — indices ${startIndex}..${endIndex}`);
  console.log(`Treasury: ${treasuryStr}\n`);

  let totalSwept = 0;

  for (let i = startIndex; i <= endIndex; i++) {
    const { address, keypair } = deriveSolKeypair(i);

    let balanceLamports;
    try {
      balanceLamports = BigInt(await connection.getBalance(keypair.publicKey));
    } catch (err) {
      console.error(`  [${i}] ${address}  ERROR fetching balance: ${err.message}`);
      continue;
    }

    const balanceSol = Number(balanceLamports) / LAMPORTS_PER_SOL;

    if (balanceLamports === 0n) {
      console.log(`  [${i}] ${address}  balance: 0 SOL`);
      continue;
    }

    console.log(`  [${i}] ${address}  balance: ${balanceSol} SOL`);

    // Sweep to treasury
    const sendAmount = balanceLamports - FEE_BUFFER_LAMPORTS;
    if (sendAmount <= 0n) {
      console.log(`    -> balance too low to cover fee buffer, skipping`);
      continue;
    }

    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey:   treasuryPub,
          lamports:   sendAmount,
        })
      );

      console.log(`    -> sweeping ${Number(sendAmount) / LAMPORTS_PER_SOL} SOL`);
      const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
      console.log(`    -> confirmed  sig: ${sig}`);
      totalSwept++;
    } catch (err) {
      console.error(`    -> sweep failed: ${err.message}`);
    }
  }

  console.log(`\nDone. Swept ${totalSwept} address(es).`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
