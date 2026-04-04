/**
 * src/routes/eth-token.js
 *
 * ERC-20 token payments on any EVM-compatible chain.
 * Works for USDT, USDC, DAI, or any ERC-20 on any chain.
 *
 * POST /api/pay/eth-token
 * Body: {
 *   user_id:          string   required
 *   chain_id:         number   required   1=ETH, 56=BSC, 137=MATIC …
 *   token_address:    string   required   ERC-20 contract address (checksum or lowercase)
 *   token_symbol:     string   required   e.g. "USDT"
 *   token_decimals:   number   optional   default 18 (USDT/USDC = 6, most others = 18)
 *   amount:           string   required   human-readable, e.g. "10.5"
 *   ttl_ms?:          number   optional
 * }
 *
 * ⚠️  Treasury gas reserve guard:
 *   Before accepting a token payment, we verify the treasury has enough native
 *   asset to seed gas for the sweep (typically ~0.005 ETH).
 *   Returns 503 if reserve is insufficient.
 *
 * GET /api/pay/eth-token/:id
 */

const { Router }             = require('express');
const { ethers }             = require('ethers');
const { isChainConfigured }  = require('../config/chains');
const { getNextIndex, getPaymentById } = require('../db');
const { deriveEvmAddress }   = require('../services/hdWallet');
const { checkGasReserve }    = require('../services/evmClaimer');
const { resolveTtl, parseAmount, buildPayment, formatPayment } = require('./_helpers');

const router = Router();

// ─── POST /api/pay/eth-token ──────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const { user_id, chain_id, token_address, token_symbol, token_decimals, amount, ttl_ms } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!user_id?.toString().trim())
      return res.status(400).json({ error: 'user_id is required' });

    if (!chain_id || isNaN(Number(chain_id)))
      return res.status(400).json({ error: 'chain_id is required' });

    if (!isChainConfigured(chain_id))
      return res.status(400).json({ error: `chain_id ${chain_id} is not configured` });

    if (!token_address || !ethers.isAddress(token_address))
      return res.status(400).json({ error: 'token_address must be a valid EVM address' });

    if (!token_symbol?.toString().trim())
      return res.status(400).json({ error: 'token_symbol is required (e.g. "USDT")' });

    const decimals = token_decimals !== undefined ? parseInt(token_decimals, 10) : 18;
    if (isNaN(decimals) || decimals < 0 || decimals > 18)
      return res.status(400).json({ error: 'token_decimals must be 0–18' });

    if (!amount)
      return res.status(400).json({ error: 'amount is required' });

    let amountSmallest;
    try { amountSmallest = parseAmount(amount, decimals); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    let ttl;
    try { ttl = resolveTtl(ttl_ms); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    // ── Gas reserve guard ─────────────────────────────────────────────────────
    // For token payments the claimer must seed gas to the deposit address first.
    // If the treasury is dry — or the RPC is unreachable — reject early.
    let hasReserve;
    try {
      hasReserve = await checkGasReserve(Number(chain_id));
    } catch (rpcErr) {
      console.error('[routes/eth-token] RPC error on chain', chain_id, rpcErr.message);
      return res.status(503).json({ error: 'rpc_unavailable', message: 'Could not reach RPC for chain ' + chain_id });
    }
    if (!hasReserve) {
      return res.status(503).json({
        error: 'insufficient_gas_reserve',
        message: 'Treasury does not have enough native balance to seed gas for token sweep. Refill treasury first.',
      });
    }

    // ── Derive address ────────────────────────────────────────────────────────
    const addressIndex = await getNextIndex('evm');
    const address      = deriveEvmAddress(addressIndex);

    const payment = await buildPayment({
      user_id,
      chain_type:     'evm',
      chain_id:       Number(chain_id),
      token_address:  ethers.getAddress(token_address), // normalise to checksum
      token_symbol:   String(token_symbol).trim().toUpperCase(),
      token_decimals: decimals,
      address,
      address_index:  addressIndex,
      amountSmallest,
      ttl,
    });

    const sym = String(token_symbol).trim().toUpperCase();
    console.log(`[payment:new] user=${payment.user_id} id=${payment.id} address=${address} amount=${amount} ${sym} token=${ethers.getAddress(token_address)} chain_id=${chain_id} expires=${new Date(payment.expires_at).toISOString()}`);

    return res.status(201).json(formatPayment({ ...payment, status: 'pending', amount_received: '0', tx_hash: null, confirmations: 0 }));
  } catch (err) {
    console.error('[routes/eth-token POST]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/pay/eth-token/:id ───────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const payment = await getPaymentById(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    return res.json(formatPayment(payment));
  } catch (err) {
    console.error('[routes/eth-token GET]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
