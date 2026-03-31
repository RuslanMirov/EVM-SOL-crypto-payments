/**
 * src/routes/sol.js
 *
 * Native SOL payments.
 *
 * POST /api/pay/sol
 * Body: {
 *   user_id:   string   required
 *   amount:    string   required   human-readable SOL, e.g. "0.5"
 *   ttl_ms?:   number   optional
 * }
 *
 * GET /api/pay/sol/:id
 *
 * 1 SOL = 1_000_000_000 lamports (9 decimals)
 */

const { Router }           = require('express');
const { isSolConfigured }  = require('../config/solProvider');
const { getNextIndex, getPaymentById } = require('../db');
const { deriveSolAddress } = require('../services/hdWallet');
const { resolveTtl, parseAmount, buildPayment, formatPayment } = require('./_helpers');

const router = Router();

const SOL_DECIMALS = 9;

// ─── POST /api/pay/sol ───────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const { user_id, amount, ttl_ms } = req.body;

    if (!user_id?.toString().trim())
      return res.status(400).json({ error: 'user_id is required' });

    if (!isSolConfigured())
      return res.status(400).json({ error: 'Solana is not configured on this server' });

    if (!amount)
      return res.status(400).json({ error: 'amount is required (human-readable, e.g. "0.5")' });

    let amountLamports;
    try { amountLamports = parseAmount(amount, SOL_DECIMALS); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    let ttl;
    try { ttl = resolveTtl(ttl_ms); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    const addressIndex = await getNextIndex('sol');
    const address      = deriveSolAddress(addressIndex);

    const payment = await buildPayment({
      user_id, chain_type: 'sol', chain_id: null,
      token_address: null, token_symbol: 'SOL', token_decimals: SOL_DECIMALS,
      address, address_index: addressIndex, amountSmallest: amountLamports, ttl,
    });

    return res.status(201).json(formatPayment({
      ...payment, status: 'pending', amount_received: '0', tx_hash: null, confirmations: 0,
    }));
  } catch (err) {
    console.error('[routes/sol POST]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/pay/sol/:id ────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const payment = await getPaymentById(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    return res.json(formatPayment(payment));
  } catch (err) {
    console.error('[routes/sol GET]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
