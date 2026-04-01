/**
 * src/app.js
 */

const express = require('express');
const app = express();

app.use(express.json());

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ─── Pay routes ───────────────────────────────────────────────────────────────
//  /api/pay/eth          native asset on any EVM chain (ETH / BNB / MATIC / …)
//  /api/pay/eth-token    ERC-20 on any EVM chain (USDT / USDC / DAI / …)
//  /api/pay/sol          native SOL  (stub)
//  /api/pay/sol-token    SPL token   (stub)
app.use('/api/pay/eth',       require('./routes/eth'));
app.use('/api/pay/eth-token', require('./routes/eth-token'));
app.use('/api/pay/sol',       require('./routes/sol'));
app.use('/api/pay/sol-token', require('./routes/sol-token'));

// ─── Payment view routes (universal — all chains/tokens) ────────────────────
app.use('/api/payments',      require('./routes/payments'));

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ─── Error handler ────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[app]', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
