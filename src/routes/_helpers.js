/**
 * src/routes/_helpers.js
 *
 * Shared logic used by all 4 pay routes:
 *   - input validation
 *   - payment record creation
 *   - response formatting
 */

const { v4: uuid }      = require('uuid');
const { ethers }        = require('ethers');
const { createPayment } = require('../db');

const DEFAULT_TTL_MS = parseInt(process.env.DEFAULT_TTL_MS || '1800000', 10); // 30 min
const MAX_TTL_MS     = 2 * 60 * 60 * 1000; // 2 h hard cap

/**
 * Clamp and validate the optional ttl_ms body field.
 */
function resolveTtl(ttl_ms) {
  if (!ttl_ms) return DEFAULT_TTL_MS;
  const v = parseInt(ttl_ms, 10);
  if (isNaN(v) || v <= 0) throw new Error('ttl_ms must be a positive integer');
  return Math.min(v, MAX_TTL_MS);
}

/**
 * Parse a human-readable amount (e.g. "10.5") into the smallest unit (BigInt).
 * Uses ethers.parseUnits so it handles arbitrary decimals safely.
 *
 * @param {string|number} amount   human-readable amount
 * @param {number}        decimals token decimals (18 for native ETH/BNB/MATIC, 6 for USDT, etc.)
 */
function parseAmount(amount, decimals = 18) {
  try {
    const parsed = ethers.parseUnits(String(amount), decimals);
    if (parsed <= 0n) throw new Error('amount must be > 0');
    return parsed;
  } catch (e) {
    throw new Error(`Invalid amount "${amount}": ${e.message}`);
  }
}

/**
 * Build and insert a payment row. Returns the full payment object.
 */
async function buildPayment({
  user_id, chain_type, chain_id = null,
  token_address = null, token_symbol, token_decimals = 18,
  address, address_index, amountSmallest,
  ttl,
}) {
  const now = Date.now();
  const payment = {
    id:              uuid(),
    user_id:         String(user_id).trim(),
    chain_type,
    chain_id:        chain_id !== null ? Number(chain_id) : null,
    token_address:   token_address ? token_address.toLowerCase() : null,
    token_symbol,
    token_decimals,
    address,
    address_index,
    amount_expected: amountSmallest.toString(),
    created_at:      now,
    updated_at:      now,
    expires_at:      now + ttl,
  };
  await createPayment(payment);
  return payment;
}

/**
 * Standard API response shape for a payment.
 */
function formatPayment(p) {
  const amountHuman = (() => {
    try { return ethers.formatUnits(BigInt(p.amount_expected), p.token_decimals); }
    catch { return p.amount_expected; }
  })();
  const receivedHuman = (() => {
    try { return ethers.formatUnits(BigInt(p.amount_received || '0'), p.token_decimals); }
    catch { return '0'; }
  })();

  return {
    payment_id:       p.id,
    user_id:          p.user_id,
    chain_type:       p.chain_type,
    chain_id:         p.chain_id,
    token_address:    p.token_address || null,
    token_symbol:     p.token_symbol,
    token_decimals:   p.token_decimals,
    address:          p.address,
    status:           p.status,
    amount_expected:  amountHuman,
    amount_received:  receivedHuman,
    amount_raw:       p.amount_expected,
    tx_hash:          p.tx_hash  || null,
    confirmations:    p.confirmations,
    created_at:       new Date(p.created_at).toISOString(),
    updated_at:       new Date(p.updated_at).toISOString(),
    expires_at:       new Date(p.expires_at).toISOString(),
  };
}

module.exports = { resolveTtl, parseAmount, buildPayment, formatPayment };
