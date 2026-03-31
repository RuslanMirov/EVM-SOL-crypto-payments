/**
 * src/services/solClaimer.js
 *
 * Sweeps confirmed SOL payments to the treasury address.
 *
 * ── Native SOL ───────────────────────────────────────────────────────────────
 *   balance − fee buffer (5000 lamports) → treasury
 *
 * ── SPL token ────────────────────────────────────────────────────────────────
 *   1. Seed gas (0.003 SOL) from treasury → deposit keypair (ATA rent + tx fee)
 *   2. Transfer SPL tokens deposit ATA → treasury ATA
 *   3. Close deposit ATA to reclaim rent back to treasury
 */

const {
  PublicKey, Keypair, Transaction, SystemProgram,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createCloseAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} = require('@solana/spl-token');
const { getConnection, getSolTreasury } = require('../config/solProvider');
const { deriveSolKeypair }              = require('./hdWallet');
const { updatePaymentStatus }           = require('../db');

require('dotenv').config();

const FEE_BUFFER_LAMPORTS = 5_000n;          // tx fee for native transfer
const GAS_SEED_LAMPORTS   = 3_000_000n;      // 0.003 SOL for ATA rent + fees
const DUST_LAMPORTS       = 10_000n;         // minimum balance worth sweeping
const MIN_RESERVE         = 0.01 * LAMPORTS_PER_SOL; // treasury must hold at least 0.01 SOL

// ─── Native SOL claim ────────────────────────────────────────────────────────

async function claimNative(payment) {
  const connection  = getConnection();
  const treasuryPub = new PublicKey(getSolTreasury());
  const { keypair }  = deriveSolKeypair(payment.address_index);

  const balance = BigInt(await connection.getBalance(keypair.publicKey));
  if (balance < DUST_LAMPORTS) return _fail(payment.id, 'dust_balance');

  const sendAmount = balance - FEE_BUFFER_LAMPORTS;
  if (sendAmount <= 0n) return _fail(payment.id, 'fee_exceeds_balance');

  console.log(`[claimer:sol] sweep ${Number(sendAmount) / LAMPORTS_PER_SOL} SOL  ${keypair.publicKey.toBase58()} → ${treasuryPub.toBase58()}`);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey:   treasuryPub,
      lamports:   sendAmount,
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
  await updatePaymentStatus({ id: payment.id, status: 'claimed', updated_at: Date.now() });
  console.log(`[claimer:sol] payment ${payment.id} claimed ✓  sig=${sig}`);
}

// ─── SPL token claim ─────────────────────────────────────────────────────────

async function claimToken(payment) {
  const connection  = getConnection();
  const treasuryPub = new PublicKey(getSolTreasury());
  const mintPub     = new PublicKey(payment.token_address);
  const { keypair }  = deriveSolKeypair(payment.address_index);

  // Treasury signer (needed for gas seeding)
  const treasuryKey = process.env.SOL_TREASURY_PRIVATE_KEY;
  if (!treasuryKey) throw new Error('SOL_TREASURY_PRIVATE_KEY not set (needed for token gas seeding)');
  const treasuryKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(treasuryKey))
  );

  // Derive ATAs
  const depositAta  = await getAssociatedTokenAddress(mintPub, keypair.publicKey);
  const treasuryAta = await getAssociatedTokenAddress(mintPub, treasuryPub);

  // Check token balance on deposit ATA
  let tokenBalance;
  try {
    const account = await getAccount(connection, depositAta);
    tokenBalance  = account.amount; // bigint
  } catch {
    return _fail(payment.id, 'token_account_not_found');
  }
  if (tokenBalance === 0n) return _fail(payment.id, 'token_balance_zero');

  // ── Step 1: seed gas from treasury → deposit keypair ──────────────────────
  console.log(`[claimer:sol] seeding gas ${Number(GAS_SEED_LAMPORTS) / LAMPORTS_PER_SOL} SOL → ${keypair.publicKey.toBase58()}`);
  const seedTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: treasuryKeypair.publicKey,
      toPubkey:   keypair.publicKey,
      lamports:   GAS_SEED_LAMPORTS,
    })
  );
  await sendAndConfirmTransaction(connection, seedTx, [treasuryKeypair]);

  // ── Step 2: ensure treasury ATA exists, transfer tokens, close deposit ATA
  const tx = new Transaction();

  // Create treasury ATA if it doesn't exist
  try {
    await getAccount(connection, treasuryAta);
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey,   // payer
        treasuryAta,         // ata
        treasuryPub,         // owner
        mintPub,             // mint
      )
    );
  }

  // Transfer tokens: deposit ATA → treasury ATA
  tx.add(
    createTransferInstruction(
      depositAta,          // source
      treasuryAta,         // destination
      keypair.publicKey,   // owner / authority
      tokenBalance,        // amount
    )
  );

  // Close deposit ATA → reclaim rent to treasury
  tx.add(
    createCloseAccountInstruction(
      depositAta,          // account to close
      treasuryPub,         // rent destination
      keypair.publicKey,   // authority
    )
  );

  console.log(`[claimer:sol] transferring ${tokenBalance} ${payment.token_symbol} → ${treasuryPub.toBase58()}`);
  const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

  await updatePaymentStatus({ id: payment.id, status: 'claimed', updated_at: Date.now() });
  console.log(`[claimer:sol] token payment ${payment.id} claimed ✓  sig=${sig}`);
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

async function claim(payment) {
  try {
    if (payment.token_address) {
      return await claimToken(payment);
    }
    return await claimNative(payment);
  } catch (err) {
    console.error(`[claimer:sol] payment ${payment.id} error:`, err.message);
    await _fail(payment.id, err.message);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function _fail(id, reason) {
  await updatePaymentStatus({ id, status: 'failed', updated_at: Date.now() });
  console.error(`[claimer:sol] payment ${id} failed: ${reason}`);
}

/**
 * Check treasury has enough SOL to seed gas for a token payment.
 * @param {number} [minReserve] — default 0.01 SOL
 */
async function checkSolGasReserve(minReserve = MIN_RESERVE) {
  const connection  = getConnection();
  const treasuryPub = new PublicKey(getSolTreasury());
  const balance     = await connection.getBalance(treasuryPub);
  return balance >= minReserve;
}

module.exports = { claim, claimNative, claimToken, checkSolGasReserve };
