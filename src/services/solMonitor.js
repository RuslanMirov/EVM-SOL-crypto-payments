/**
 * src/services/solMonitor.js
 *
 * Polls Solana for active (pending/confirming) payments.
 *
 * State machine per payment:
 *   pending    ──(balance >= expected)──▶  confirming
 *   confirming ──(slot confs >= N)     ──▶  confirmed  ──▶  claim triggered
 *   pending    ──(TTL expired)         ──▶  expired    (via expireStale)
 */

const { PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getAssociatedTokenAddress, getAccount } = require('@solana/spl-token');
const { getConnection }    = require('../config/solProvider');
const {
  getPendingPayments,
  updatePaymentStatus,
  expireStale,
} = require('../db');
const { claim } = require('./solClaimer');

require('dotenv').config();

const POLL_MS  = parseInt(process.env.POLL_INTERVAL_MS    || '15000', 10);
const REQUIRED = parseInt(process.env.SOL_CONFIRMATIONS   || '2',     10);

const _claimInProgress = new Set();

// ─── Main tick ───────────────────────────────────────────────────────────────

async function pollSol() {
  const nowMs = Date.now();
  await expireStale(nowMs);

  const payments = await getPendingPayments({ chainType: 'sol', nowMs });
  if (!payments.length) return;

  const connection = getConnection();
  let currentSlot;
  try {
    currentSlot = await connection.getSlot();
  } catch (err) {
    console.error('[monitor:sol] getSlot failed:', err.message);
    return;
  }

  await Promise.allSettled(
    payments
      .filter(p => !_claimInProgress.has(p.id))
      .map(p => checkPayment(p, connection, currentSlot))
  );
}

// ─── Per-payment check ───────────────────────────────────────────────────────

async function checkPayment(payment, connection, currentSlot) {
  // ── Get current balance (native or token) ────────────────────────────────
  let balance;
  if (payment.token_address) {
    balance = await getTokenBalance(connection, payment.token_address, payment.address);
  } else {
    balance = BigInt(await connection.getBalance(new PublicKey(payment.address)));
  }

  const expected = BigInt(payment.amount_expected);
  if (balance < expected) return; // still waiting

  // ── Locate the inbound tx (best-effort) ──────────────────────────────────
  const txSig = await findInboundTx(connection, payment.address);

  // ── Confirmations ────────────────────────────────────────────────────────
  let confirmations = 0;
  if (txSig) {
    try {
      const status = await connection.getSignatureStatus(txSig);
      if (status?.value?.confirmationStatus === 'finalized') {
        confirmations = REQUIRED; // finalized = max confidence
      } else if (status?.value?.slot) {
        confirmations = Math.max(0, currentSlot - status.value.slot);
      }
    } catch { /* non-fatal */ }
  }

  const confirmed = confirmations >= REQUIRED;
  const newStatus = confirmed ? 'confirmed' : 'confirming';

  await updatePaymentStatus({
    id:              payment.id,
    status:          newStatus,
    amount_received: balance.toString(),
    tx_hash:         txSig,
    confirmations,
    updated_at:      Date.now(),
  });

  if (payment.status === 'pending') {
    const display = payment.token_address
      ? `${balance} ${payment.token_symbol}`
      : `${Number(balance) / LAMPORTS_PER_SOL} SOL`;
    console.log(`[monitor:sol] ${payment.id} funded (${display}) — ${newStatus}`);
  }

  if (confirmed) {
    console.log(`[monitor:sol] ${payment.id} confirmed (${confirmations} slots) — claiming`);
    _claimInProgress.add(payment.id);
    claim(payment)
      .catch(e => console.error(`[monitor:sol] claim error ${payment.id}:`, e.message))
      .finally(() => _claimInProgress.delete(payment.id));
  }
}

// ─── Balance helpers ─────────────────────────────────────────────────────────

async function getTokenBalance(connection, mintAddress, walletAddress) {
  try {
    const mintPub  = new PublicKey(mintAddress);
    const ownerPub = new PublicKey(walletAddress);
    const ata      = await getAssociatedTokenAddress(mintPub, ownerPub);
    const account  = await getAccount(connection, ata);
    return account.amount; // bigint
  } catch {
    return 0n; // ATA doesn't exist yet — no tokens received
  }
}

// ─── Tx discovery (best-effort) ──────────────────────────────────────────────

async function findInboundTx(connection, address) {
  try {
    const sigs = await connection.getSignaturesForAddress(
      new PublicKey(address),
      { limit: 5 },
      'confirmed'
    );
    if (sigs.length) return sigs[0].signature;
  } catch { /* non-fatal */ }
  return null;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

let _running = false;
let _timer   = null;

function startSolMonitor() {
  if (_running) return;
  _running = true;
  console.log(`[monitor:sol] started — polling every ${POLL_MS / 1000}s`);

  async function tick() {
    try { await pollSol(); }
    catch (e) { console.error('[monitor:sol] uncaught:', e.message); }
    finally { if (_running) _timer = setTimeout(tick, POLL_MS); }
  }

  tick();
}

function stopSolMonitor() {
  _running = false;
  if (_timer) clearTimeout(_timer);
  console.log('[monitor:sol] stopped');
}

module.exports = { startSolMonitor, stopSolMonitor };
