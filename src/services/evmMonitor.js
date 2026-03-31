/**
 * src/services/evmMonitor.js
 *
 * Polls all EVM chains that have active (pending/confirming) payments.
 * Chains are discovered dynamically from the DB — no hardcoded list needed.
 *
 * State machine per payment:
 *   pending    ──(balance ≥ expected)──▶  confirming
 *   confirming ──(confs ≥ N)          ──▶  confirmed  ──▶  claim triggered
 *   pending    ──(TTL expired)        ──▶  expired    (via expireStale)
 */

const { ethers }           = require('ethers');
const { getProvider }      = require('../config/evmProvider');
const { isChainConfigured }= require('../config/chains');
const {
  getPendingPayments,
  updatePaymentStatus,
  expireStale,
  getActiveChains,
} = require('../db');
const { claim } = require('./evmClaimer');

require('dotenv').config();

const POLL_MS     = parseInt(process.env.POLL_INTERVAL_MS  || '15000', 10);
const REQUIRED    = parseInt(process.env.EVM_CONFIRMATIONS || '2',     10);
const SCAN_BLOCKS = 30;

const _claimInProgress = new Set();

// ─── Main tick ────────────────────────────────────────────────────────────────

async function pollEvm() {
  const nowMs = Date.now();
  await expireStale(nowMs);

  // Discover all EVM chains with active payments
  const chains = await getActiveChains();
  const evmChains = chains
    .filter(r => r.chain_type === 'evm' && isChainConfigured(r.chain_id));

  await Promise.allSettled(evmChains.map(({ chain_id }) => pollChain(chain_id, nowMs)));
}

async function pollChain(chainId, nowMs) {
  const payments = await getPendingPayments({ chainType: 'evm', chainId, nowMs });
  if (!payments.length) return;

  let currentBlock;
  try {
    currentBlock = await getProvider(chainId).getBlockNumber();
  } catch (err) {
    console.error(`[monitor:evm:${chainId}] getBlockNumber failed:`, err.message);
    return;
  }

  await Promise.allSettled(
    payments
      .filter(p => !_claimInProgress.has(p.id))
      .map(p => checkPayment(p, chainId, currentBlock))
  );
}

// ─── Per-payment check ────────────────────────────────────────────────────────

async function checkPayment(payment, chainId, currentBlock) {
  const provider = getProvider(chainId);

  // ── Get current balance (native or token) ───────────────────────────────────
  let balance;
  if (payment.token_address) {
    balance = await getTokenBalance(provider, payment.token_address, payment.address);
  } else {
    balance = await provider.getBalance(payment.address);
  }

  const expected = BigInt(payment.amount_expected);
  if (balance < expected) return; // still waiting

  // ── Locate the inbound tx (best-effort) ─────────────────────────────────────
  const txHash = payment.token_address
    ? await findTokenTx(provider, payment.token_address, payment.address, currentBlock)
    : await findNativeTx(provider, payment.address, currentBlock);

  // ── Confirmations ────────────────────────────────────────────────────────────
  let confirmations = 0;
  if (txHash) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt?.blockNumber) {
      confirmations = Math.max(0, currentBlock - receipt.blockNumber);
    }
  }

  const confirmed = confirmations >= REQUIRED;
  const newStatus = confirmed ? 'confirmed' : 'confirming';

  await updatePaymentStatus({
    id:              payment.id,
    status:          newStatus,
    amount_received: balance.toString(),
    tx_hash:         txHash,
    confirmations,
    updated_at:      Date.now(),
  });

  if (payment.status === 'pending') {
    const display = payment.token_address
      ? `${balance} ${payment.token_symbol}`
      : `${ethers.formatEther(balance)} native`;
    console.log(`[monitor:evm:${chainId}] ${payment.id} funded (${display}) — ${newStatus}`);
  }

  if (confirmed) {
    console.log(`[monitor:evm:${chainId}] ${payment.id} confirmed (${confirmations} blocks) — claiming`);
    _claimInProgress.add(payment.id);
    claim(payment)
      .catch(e => console.error(`[monitor:evm:${chainId}] claim error ${payment.id}:`, e.message))
      .finally(() => _claimInProgress.delete(payment.id));
  }
}

// ─── Balance helpers ─────────────────────────────────────────────────────────

const ERC20_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];

async function getTokenBalance(provider, tokenAddress, walletAddress) {
  const { ethers } = require('ethers');
  const contract = new ethers.Contract(tokenAddress, ERC20_BALANCE_ABI, provider);
  return contract.balanceOf(walletAddress);
}

// ─── Tx discovery (best-effort) ───────────────────────────────────────────────

async function findNativeTx(provider, address, currentBlock) {
  const addrLower = address.toLowerCase();
  const fromBlock = Math.max(0, currentBlock - SCAN_BLOCKS);
  try {
    for (let b = currentBlock; b >= fromBlock; b--) {
      const block = await provider.getBlock(b, true);
      if (!block?.transactions) continue;
      for (const tx of block.transactions) {
        if (typeof tx !== 'string' && tx.to?.toLowerCase() === addrLower) return tx.hash;
      }
    }
  } catch (_) { /* non-fatal */ }
  return null;
}

async function findTokenTx(provider, tokenAddress, toAddress, currentBlock) {
  // ERC-20 Transfer event: Transfer(address indexed from, address indexed to, uint256 value)
  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  const paddedTo      = ethers.zeroPadValue(toAddress, 32);
  const fromBlock     = Math.max(0, currentBlock - SCAN_BLOCKS);
  try {
    const logs = await provider.getLogs({
      fromBlock,
      toBlock:  currentBlock,
      address:  tokenAddress,
      topics:   [transferTopic, null, paddedTo],
    });
    if (logs.length) return logs[logs.length - 1].transactionHash;
  } catch (_) { /* non-fatal */ }
  return null;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let _running = false;
let _timer   = null;

function startEvmMonitor() {
  if (_running) return;
  _running = true;
  console.log(`[monitor:evm] started — polling every ${POLL_MS / 1000}s`);

  async function tick() {
    try { await pollEvm(); }
    catch (e) { console.error('[monitor:evm] uncaught:', e.message); }
    finally { if (_running) _timer = setTimeout(tick, POLL_MS); }
  }

  tick();
}

function stopEvmMonitor() {
  _running = false;
  if (_timer) clearTimeout(_timer);
  console.log('[monitor:evm] stopped');
}

module.exports = { startEvmMonitor, stopEvmMonitor };
