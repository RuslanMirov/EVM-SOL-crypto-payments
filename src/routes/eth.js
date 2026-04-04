/**
 * src/routes/eth.js
 *
 * Native-asset payments on any EVM-compatible chain.
 *
 * POST /api/pay/eth
 * Body: {
 *   user_id:    string   required
 *   chain_id:   number   required   1=ETH | 56=BNB | 137=MATIC | 42161=ARB …
 *   amount:     string   required   human-readable, e.g. "0.05"
 *   ttl_ms?:    number   optional   expiry window in ms (max 2 h)
 * }
 *
 * GET /api/pay/eth/:id
 *
 * Native symbol per chain (for display only):
 *   1→ETH, 56→BNB, 137→MATIC, 42161→ETH, 10→ETH, 8453→ETH, 43114→AVAX, …
 *   Any unmapped chain_id falls back to "NATIVE".
 */

const { Router }             = require('express');
const { isChainConfigured }  = require('../config/chains');
const { getNextIndex, getPaymentById } = require('../db');
const { deriveEvmAddress }   = require('../services/hdWallet');
const { resolveTtl, parseAmount, buildPayment, formatPayment } = require('./_helpers');

const router = Router();

const NATIVE_SYMBOLS = {
  1:     'ETH',
  56:    'BNB',
  97:    'tBNB',
  137:   'MATIC',
  80001: 'MATIC',
  42161: 'ETH',
  10:    'ETH',
  8453:  'ETH',
  43114: 'AVAX',
  250:   'FTM',
  25:    'CRO',
};

function nativeSymbol(chainId) {
  return NATIVE_SYMBOLS[Number(chainId)] || 'NATIVE';
}

// ─── POST /api/pay/eth ────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const { user_id, chain_id, amount, ttl_ms } = req.body;

    if (!user_id?.toString().trim())
      return res.status(400).json({ error: 'user_id is required' });

    if (!chain_id || isNaN(Number(chain_id)))
      return res.status(400).json({ error: 'chain_id is required (e.g. 1 for Ethereum, 56 for BSC)' });

    if (!isChainConfigured(chain_id))
      return res.status(400).json({ error: `chain_id ${chain_id} is not configured on this server` });

    if (!amount)
      return res.status(400).json({ error: 'amount is required (human-readable, e.g. "0.05")' });

    let amountWei;
    try { amountWei = parseAmount(amount, 18); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    let ttl;
    try { ttl = resolveTtl(ttl_ms); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    const addressIndex = await getNextIndex('evm');
    const address      = deriveEvmAddress(addressIndex);
    const symbol       = nativeSymbol(chain_id);

    const payment = await buildPayment({
      user_id, chain_type: 'evm', chain_id: Number(chain_id),
      token_address: null, token_symbol: symbol, token_decimals: 18,
      address, address_index: addressIndex, amountSmallest: amountWei, ttl,
    });

    console.log(`[payment:new] user=${payment.user_id} id=${payment.id} address=${address} amount=${amount} ${symbol} chain_id=${chain_id} expires=${new Date(payment.expires_at).toISOString()}`);

    return res.status(201).json(formatPayment({ ...payment, status: 'pending', amount_received: '0', tx_hash: null, confirmations: 0 }));
  } catch (err) {
    console.error('[routes/eth POST]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/pay/eth/:id ─────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const payment = await getPaymentById(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    return res.json(formatPayment(payment));
  } catch (err) {
    console.error('[routes/eth GET]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
