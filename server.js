/**
 * server.js
 *
 * Boots the HTTP server and the EVM monitor.
 * Waits for MySQL to be reachable before accepting traffic.
 */

require('dotenv').config();

const app                  = require('./src/app');
const { ping }             = require('./src/db/mysql');
const { startEvmMonitor, stopEvmMonitor } = require('./src/services/evmMonitor');
const { getConfiguredChainIds }           = require('./src/config/chains');

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
  // ── DB readiness ────────────────────────────────────────────────────────────
  console.log('[server] Waiting for MySQL…');
  let retries = 10;
  while (retries--) {
    try { await ping(); break; }
    catch (e) {
      if (!retries) { console.error('[server] MySQL unreachable, giving up'); process.exit(1); }
      console.warn(`[server] MySQL not ready (${e.message}), retrying in 2s…`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.log('[server] MySQL connected ✓');

  // ── Configured chains ───────────────────────────────────────────────────────
  const chains = getConfiguredChainIds();
  console.log(`[server] Configured EVM chains: [${chains.join(', ')}]`);

  // ── HTTP ────────────────────────────────────────────────────────────────────
  const server = app.listen(PORT, () => {
    console.log(`\n🟢  Crypto Pay API  →  http://localhost:${PORT}`);
    console.log(`    POST /api/pay/eth          native (ETH/BNB/MATIC/…)`);
    console.log(`    POST /api/pay/eth-token    ERC-20 (USDT/USDC/DAI/…)`);
    console.log(`    POST /api/pay/sol          SOL (stub)`);
    console.log(`    POST /api/pay/sol-token    SPL token (stub)\n`);
  });

  // ── Monitor ─────────────────────────────────────────────────────────────────
  if (chains.length) {
    startEvmMonitor();
  } else {
    console.warn('[server] No EVM chains configured — monitor not started');
  }

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  const shutdown = (sig) => {
    console.log(`\n[server] ${sig} — shutting down…`);
    stopEvmMonitor();
    server.close(() => { console.log('[server] closed'); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main().catch(e => { console.error('[server] fatal:', e); process.exit(1); });
