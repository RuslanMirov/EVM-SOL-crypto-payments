/**
 * src/routes/payments.js
 *
 * Universal payment view router — works for all chain types (EVM, SOL, tokens).
 *
 * Endpoints:
 *   GET /pay-history?user_id=…        — full payment history for a user
 *   GET /verify-payment?user_id=…&address=…  — check if a specific payment is done
 *
 * All endpoints require Bearer token authentication via the API_BEARER_TOKEN env var.
 */

const { Router } = require('express');
const { getPaymentsByUserId, getPaymentByUserAndAddress } = require('../db');
const { formatPayment } = require('./_helpers');

const router = Router();

// ─── Bearer-token middleware ─────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const expected = process.env.API_BEARER_TOKEN;
  if (!expected) return res.status(500).json({ error: 'API_BEARER_TOKEN not configured' });

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = header.slice(7);
  if (token !== expected) {
    return res.status(403).json({ error: 'Invalid bearer token' });
  }

  next();
}

router.use(requireAuth);

// ─── GET /pay-history ────────────────────────────────────────────────────────

router.get('/pay-history', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id query parameter is required' });

    const payments = await getPaymentsByUserId(String(user_id).trim());
    res.json({ user_id, total: payments.length, payments: payments.map(formatPayment) });
  } catch (err) {
    console.error('[payments] pay-history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /verify-payment ────────────────────────────────────────────────────

router.get('/verify-payment', async (req, res) => {
  try {
    const { user_id, address } = req.query;
    if (!user_id || !address) {
      return res.status(400).json({ error: 'user_id and address query parameters are required' });
    }

    const payment = await getPaymentByUserAndAddress(
      String(user_id).trim(),
      String(address).trim()
    );

    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const paid = ['confirmed', 'claimed'].includes(payment.status);
    res.json({ user_id, address, paid, status: payment.status });
  } catch (err) {
    console.error('[payments] verify-payment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
