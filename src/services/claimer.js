/**
 * src/services/claimer.js
 *
 * Sweeps ETH from a deposit address → base/treasury address after confirmation.
 *
 * ETH_USDT claim design (to implement later):
 *   1. Check USDT balance on deposit address
 *   2. Estimate ERC-20 transfer gas
 *   3. Send gas-ETH from base address → deposit address  (gas seeding)
 *   4. Wait for seed confirmation
 *   5. Transfer USDT from deposit address → base address
 *
 *   Guard at payment-creation time:
 *     Before issuing a USDT deposit address, assert that ETH_BASE_ADDRESS holds
 *     at least GAS_SEED_RESERVE_ETH (e.g. 0.005 ETH).  If not → 503.
 */

const { ethers } = require('ethers');
const { getEthProvider } = require('../config/ethProvider');
const { deriveEthKeypair } = require('./hdWallet');
const { updatePaymentStatus } = require('../db');

require('dotenv').config();

const ETH_BASE_ADDRESS     = process.env.ETH_BASE_ADDRESS;
const REQUIRED_CONFS       = parseInt(process.env.ETH_CONFIRMATIONS || '2', 10);
const ETH_TRANSFER_GAS     = 21_000n;
const DUST_THRESHOLD       = ethers.parseEther('0.00005'); // skip if < 0.05 mETH

async function claimEth(payment) {
  const provider = getEthProvider();
  const { address_index, id } = payment;

  const { privateKey, address } = deriveEthKeypair(address_index);
  const wallet = new ethers.Wallet(privateKey, provider);

  const balance = await provider.getBalance(address);

  if (balance < DUST_THRESHOLD) {
    console.warn(`[claimer] ${address} balance dust (${balance} wei) — skipping`);
    return _fail(id, 'balance_too_low');
  }

  const feeData  = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
  if (!gasPrice) throw new Error('Could not fetch gas price');

  const gasCost    = gasPrice * ETH_TRANSFER_GAS;
  const sendAmount = balance - gasCost;

  if (sendAmount <= 0n) {
    console.warn(`[claimer] Gas (${gasCost}) >= balance (${balance}) on ${address}`);
    return _fail(id, 'gas_exceeds_balance');
  }

  console.log(`[claimer] Sweeping ${ethers.formatEther(sendAmount)} ETH  ${address} → ${ETH_BASE_ADDRESS}`);

  const tx = await wallet.sendTransaction({
    to:        ETH_BASE_ADDRESS,
    value:     sendAmount,
    gasLimit:  ETH_TRANSFER_GAS,
    gasPrice,
  });

  console.log(`[claimer] Claim tx: ${tx.hash}`);
  const receipt = await tx.wait(REQUIRED_CONFS);

  if (receipt?.status === 1) {
    updatePaymentStatus({ id, status: 'claimed', updated_at: Date.now() });
    console.log(`[claimer] Payment ${id} claimed ✓`);
  } else {
    _fail(id, 'claim_tx_reverted');
  }
}

function _fail(id, reason) {
  updatePaymentStatus({ id, status: 'failed', updated_at: Date.now() });
  console.error(`[claimer] Payment ${id} failed: ${reason}`);
}

// ─── Stubs for future chains ──────────────────────────────────────────────────
async function claimEthUsdt(_payment) {
  throw new Error('ETH_USDT claim not yet implemented');
}

module.exports = { claimEth, claimEthUsdt };
