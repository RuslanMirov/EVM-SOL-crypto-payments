/**
 * src/services/monitor.js
 *
 * Background polling loop — checks all pending/confirming ETH payments.
 *
 * State machine per payment:
 *   pending    ──(balance >= expected)──▶  confirming
 *   confirming ──(confs >= N)          ──▶  confirmed  ──▶  claim triggered
 *   pending    ──(expires_at passed)   ──▶  expired    (via expireStale)
 *
 * Design notes:
 *   • HTTP polling (not WebSocket subscriptions) — works with any JSON-RPC provider
 *   • Tx-hash discovery scans recent blocks; non-fatal if not found
 *   • _claimInProgress set prevents duplicate claim calls within a poll cycle
 */

const { ethers }           = require('ethers');
const { getEthProvider }   = require('../config/ethProvider');
const { getPendingByType, updatePaymentStatus, expireStale } = require('../db');
const { claimEth }         = require('./claimer');

require('dotenv').config();

const POLL_MS     = parseInt(process.env.POLL_INTERVAL_MS  || '15000', 10);
const REQUIRED    = parseInt(process.env.ETH_CONFIRMATIONS || '2',     10);
const SCAN_BLOCKS = 30; // how many blocks back to search for inbound tx hash

let _running = false;
let _timer   = null;
const _claimInProgress = new Set();

// ─── ETH ──────────────────────────────────────────────────────────────────────

async function pollEth() {
  const provider = getEthProvider();
  const now      = Date.now();

  expireStale(now);

  const payments = getPendingByType('ETH', now);
  if (!payments.length) return;

  let currentBlock;
  try {
    currentBlock = await provider.getBlockNumber();
  } catch (err) {
    console.error('[monitor:eth] getBlockNumber failed:', err.message);
    return;
  }

  await Promise.allSettled(
    payments
      .filter(p => !_claimInProgress.has(p.id))
      .map(p => checkEth(p, provider, currentBlock))
  );
}

async function checkEth(payment, provider, currentBlock) {
  const balance  = await provider.getBalance(payment.address);
  const expected = BigInt(payment.amount_expected);

  if (balance < expected) return; // still waiting

  // ── Funds arrived — resolve tx hash (best-effort) ────────────────────────
  const txHash = await findInboundTx(payment.address, provider, currentBlock);

  // ── Count confirmations ──────────────────────────────────────────────────
  let confirmations = 0;
  if (txHash) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt?.blockNumber) {
      confirmations = Math.max(0, currentBlock - receipt.blockNumber);
    }
  }

  const confirmed = confirmations >= REQUIRED;
  const newStatus = confirmed ? 'confirmed' : 'confirming';

  updatePaymentStatus({
    id:              payment.id,
    status:          newStatus,
    amount_received: balance.toString(),
    tx_hash:         txHash,
    confirmations,
    updated_at:      Date.now(),
  });

  if (payment.status === 'pending') {
    console.log(`[monitor:eth] Payment ${payment.id} funded (${ethers.formatEther(balance)} ETH) — ${newStatus}`);
  }

  if (confirmed) {
    console.log(`[monitor:eth] Payment ${payment.id} confirmed (${confirmations} blocks) — claiming`);
    _claimInProgress.add(payment.id);
    claimEth(payment)
      .catch(err => console.error(`[monitor:eth] Claim error ${payment.id}:`, err.message))
      .finally(() => _claimInProgress.delete(payment.id));
  }
}

/**
 * Scan recent blocks to find the tx that funded `address`.
 * Returns hash string or null — non-fatal if not found.
 */
async function findInboundTx(address, provider, currentBlock) {
  const fromBlock = Math.max(0, currentBlock - SCAN_BLOCKS);
  const addrLower = address.toLowerCase();

  try {
    for (let b = currentBlock; b >= fromBlock; b--) {
      const block = await provider.getBlock(b, true);
      if (!block?.transactions) continue;
      for (const tx of block.transactions) {
        if (typeof tx !== 'string' && tx.to?.toLowerCase() === addrLower) {
          return tx.hash;
        }
      }
    }
  } catch (_) { /* non-fatal */ }

  return null;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

function startMonitor() {
  if (_running) return;
  _running = true;
  console.log(`[monitor] Started — polling every ${POLL_MS / 1000}s`);

  async function tick() {
    try {
      await pollEth();
      // Future: await pollSol(); await pollEthUsdt();
    } catch (err) {
      console.error('[monitor] Uncaught error in tick:', err.message);
    } finally {
      if (_running) _timer = setTimeout(tick, POLL_MS);
    }
  }

  tick();
}

function stopMonitor() {
  _running = false;
  if (_timer) clearTimeout(_timer);
  console.log('[monitor] Stopped');
}

module.exports = { startMonitor, stopMonitor };
