/**
 * src/services/evmClaimer.js
 *
 * Sweeps confirmed payments to the treasury address.
 *
 * ── Native asset (ETH/BNB/MATIC …) ───────────────────────────────────────────
 *   balance − gasCost  →  treasury
 *
 * ── ERC-20 token (USDT/USDC …) ───────────────────────────────────────────────
 *   Problem: deposit address has no ETH to pay gas for the token transfer.
 *   Solution:
 *     1. Estimate gas for ERC-20 transfer
 *     2. Send gasNeeded native asset  treasury → deposit address  (gas seed)
 *     3. Wait for seed confirmation
 *     4. Transfer token  deposit address → treasury
 *
 *   Guard at payment-creation time (enforced in route):
 *     Before issuing a token deposit address, verify treasury holds at least
 *     TOKEN_GAS_SEED_MIN native asset (default 0.005 ETH equivalent).
 *     If not → 503 "insufficient_gas_reserve".
 */

const { ethers }          = require('ethers');
const { getProvider }     = require('../config/evmProvider');
const { getChainConfig }  = require('../config/chains');
const { deriveEvmKeypair }= require('./hdWallet');
const { updatePaymentStatus } = require('../db');

require('dotenv').config();

const REQUIRED_CONFS   = parseInt(process.env.EVM_CONFIRMATIONS || '2', 10);
const ETH_TRANSFER_GAS = 21_000n;
const DUST_WEI         = ethers.parseEther('0.00005');

// Minimal ERC-20 ABI — only what we need
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

// ─── Native claim ─────────────────────────────────────────────────────────────

async function claimNative(payment) {
  const provider = getProvider(payment.chain_id);
  const { base }  = getChainConfig(payment.chain_id);
  const { privateKey, address } = deriveEvmKeypair(payment.address_index);
  const wallet = new ethers.Wallet(privateKey, provider);

  const balance = await provider.getBalance(address);
  if (balance < DUST_WEI) return _fail(payment.id, 'dust_balance');

  const feeData  = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
  if (!gasPrice) throw new Error('Could not fetch gas price');

  const gasCost    = gasPrice * ETH_TRANSFER_GAS;
  const sendAmount = balance - gasCost;
  if (sendAmount <= 0n) return _fail(payment.id, 'gas_exceeds_balance');

  console.log(`[claimer] sweep ${ethers.formatEther(sendAmount)} native  ${address} → ${base}  (chain ${payment.chain_id})`);

  const tx = await wallet.sendTransaction({
    to: base, value: sendAmount,
    gasLimit: ETH_TRANSFER_GAS, gasPrice,
  });
  const receipt = await tx.wait(REQUIRED_CONFS);

  if (receipt?.status === 1) {
    await updatePaymentStatus({ id: payment.id, status: 'claimed', updated_at: Date.now() });
    console.log(`[claimer] payment ${payment.id} claimed ✓`);
  } else {
    await _fail(payment.id, 'claim_tx_reverted');
  }
}

// ─── ERC-20 token claim ───────────────────────────────────────────────────────

async function claimToken(payment) {
  const provider = getProvider(payment.chain_id);
  const { base }  = getChainConfig(payment.chain_id);
  const { privateKey, address } = deriveEvmKeypair(payment.address_index);

  const tokenContract = new ethers.Contract(payment.token_address, ERC20_ABI, provider);
  const tokenBalance  = await tokenContract.balanceOf(address);

  if (tokenBalance === 0n) return _fail(payment.id, 'token_balance_zero');

  // ── Step 1: estimate gas for the token transfer ─────────────────────────────
  const feeData  = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
  if (!gasPrice) throw new Error('Could not fetch gas price');

  // Use a fixed generous limit for ERC-20 transfers (typical ~65k, we use 100k)
  const TOKEN_TRANSFER_GAS = 100_000n;
  const gasSeedAmount      = gasPrice * TOKEN_TRANSFER_GAS;

  // ── Step 2: send gas seed from treasury → deposit address ─────────────────
  const { privateKey: _unusedKey, ...__ } = deriveEvmKeypair(0); // not used here
  // We need a signer for the treasury. Treasury key must be in env.
  const treasuryKey = process.env.EVM_TREASURY_PRIVATE_KEY;
  if (!treasuryKey) throw new Error('EVM_TREASURY_PRIVATE_KEY not set (needed for token gas seeding)');

  const treasurySigner = new ethers.Wallet(treasuryKey, provider);

  console.log(`[claimer] seeding gas ${ethers.formatEther(gasSeedAmount)} ETH → ${address}`);
  const seedTx = await treasurySigner.sendTransaction({
    to: address, value: gasSeedAmount, gasPrice,
  });
  await seedTx.wait(1); // 1 confirmation is enough for the seed

  // ── Step 3: transfer token from deposit address → treasury ─────────────────
  const depositSigner   = new ethers.Wallet(privateKey, provider);
  const tokenWithSigner = tokenContract.connect(depositSigner);

  console.log(`[claimer] transferring ${tokenBalance} ${payment.token_symbol} → ${base}`);
  const tokenTx = await tokenWithSigner.transfer(base, tokenBalance, {
    gasLimit: TOKEN_TRANSFER_GAS,
    gasPrice,
  });
  const receipt = await tokenTx.wait(REQUIRED_CONFS);

  if (receipt?.status === 1) {
    await updatePaymentStatus({ id: payment.id, status: 'claimed', updated_at: Date.now() });
    console.log(`[claimer] token payment ${payment.id} claimed ✓`);
  } else {
    await _fail(payment.id, 'token_claim_reverted');
  }
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function claim(payment) {
  if (payment.token_address) {
    return claimToken(payment);
  }
  return claimNative(payment);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function _fail(id, reason) {
  await updatePaymentStatus({ id, status: 'failed', updated_at: Date.now() });
  console.error(`[claimer] payment ${id} failed: ${reason}`);
}

/**
 * Check treasury has enough native balance to seed gas for a token payment.
 * Call this before creating a token payment.
 * @param {number} chainId
 * @param {bigint} [minReserve] — default 0.005 ETH worth
 */
async function checkGasReserve(chainId, minReserve = ethers.parseEther('0.005')) {
  const { base } = getChainConfig(chainId);
  const balance  = await getProvider(chainId).getBalance(base);
  return balance >= minReserve;
}

module.exports = { claim, claimNative, claimToken, checkGasReserve };
