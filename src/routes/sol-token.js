/**
 * src/routes/sol-token.js
 *
 * SPL token payments (SOL-chain equivalent of ERC-20).
 *
 * POST /api/pay/sol-token
 * Body: {
 *   user_id:        string   required
 *   token_mint:     string   required   SPL token mint address (base58)
 *   token_symbol:   string   required   e.g. "USDT"
 *   token_decimals: number   optional   default 6 for most SPL stablecoins
 *   amount:         string   required   human-readable amount
 *   ttl_ms?:        number   optional
 * }
 *
 * GET /api/pay/sol-token/:id
 *
 * The deposit address is the keypair's base58 public key. The monitor
 * checks the Associated Token Account (ATA) for that keypair + mint.
 *
 * Known token mints:
 *   USDT: Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
 *   USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 */

const { Router }           = require('express');
const { PublicKey }        = require('@solana/web3.js');
const { isSolConfigured }  = require('../config/solProvider');
const { getNextIndex, getPaymentById } = require('../db');
const { deriveSolAddress } = require('../services/hdWallet');
const { checkSolGasReserve } = require('../services/solClaimer');
const { resolveTtl, parseAmount, buildPayment, formatPayment } = require('./_helpers');

const router = Router();

// ─── POST /api/pay/sol-token ─────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const { user_id, token_mint, token_symbol, token_decimals, amount, ttl_ms } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!user_id?.toString().trim())
      return res.status(400).json({ error: 'user_id is required' });

    if (!isSolConfigured())
      return res.status(400).json({ error: 'Solana is not configured on this server' });

    if (!token_mint) {
      return res.status(400).json({ error: 'token_mint is required (SPL mint address)' });
    }
    try { new PublicKey(token_mint); }
    catch { return res.status(400).json({ error: 'token_mint must be a valid base58 Solana address' }); }

    if (!token_symbol?.toString().trim())
      return res.status(400).json({ error: 'token_symbol is required (e.g. "USDT")' });

    const decimals = token_decimals !== undefined ? parseInt(token_decimals, 10) : 6;
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
    let hasReserve;
    try {
      hasReserve = await checkSolGasReserve();
    } catch (rpcErr) {
      console.error('[routes/sol-token] RPC error:', rpcErr.message);
      return res.status(503).json({ error: 'rpc_unavailable', message: 'Could not reach Solana RPC' });
    }
    if (!hasReserve) {
      return res.status(503).json({
        error: 'insufficient_gas_reserve',
        message: 'Treasury does not have enough SOL to seed gas for token sweep. Refill treasury first.',
      });
    }

    // ── Derive address ────────────────────────────────────────────────────────
    const addressIndex = await getNextIndex('sol');
    const address      = deriveSolAddress(addressIndex);

    const payment = await buildPayment({
      user_id,
      chain_type:     'sol',
      chain_id:       null,
      token_address:  token_mint,
      token_symbol:   String(token_symbol).trim().toUpperCase(),
      token_decimals: decimals,
      address,
      address_index:  addressIndex,
      amountSmallest,
      ttl,
    });

    return res.status(201).json(formatPayment({
      ...payment, status: 'pending', amount_received: '0', tx_hash: null, confirmations: 0,
    }));
  } catch (err) {
    console.error('[routes/sol-token POST]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/pay/sol-token/:id ──────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const payment = await getPaymentById(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    return res.json(formatPayment(payment));
  } catch (err) {
    console.error('[routes/sol-token GET]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
