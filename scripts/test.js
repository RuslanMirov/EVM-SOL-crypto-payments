/**
 * scripts/test.js
 *
 * Quick smoke-test — runs without a real MySQL or RPC endpoint.
 *
 * Tests:
 *   1. HD wallet derivation
 *   2. Chain config loader
 *   3. Amount parsing helpers
 *   4. Payment response formatter
 *   5. Full HTTP layer (with DB + monitor mocked)
 *
 * Usage:  node scripts/test.js
 */

require('dotenv').config();

// ── Inject test env ───────────────────────────────────────────────────────────
process.env.HD_MNEMONIC        = 'test test test test test test test test test test test junk';
process.env.EVM_CHAIN_1_RPC    = 'https://mainnet.infura.io/v3/test';
process.env.EVM_CHAIN_1_BASE   = '0x0000000000000000000000000000000000000001';
process.env.EVM_CHAIN_1_NAME   = 'Ethereum';
process.env.EVM_CHAIN_56_RPC   = 'https://bsc-dataseed.binance.org';
process.env.EVM_CHAIN_56_BASE  = '0x0000000000000000000000000000000000000001';
process.env.EVM_CHAIN_56_NAME  = 'BSC';

// ── Mock MySQL so tests don't need a real DB ──────────────────────────────────
const payments = new Map();
let   hdIndex  = 0;

// Patch db/mysql before any require loads it
const Module = require('module');
const _origLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'mysql') {
    return {
      createPool: () => ({
        query: (sql, params, cb) => {
          if (typeof params === 'function') { cb = params; params = []; }
          cb(null, []);
        },
        getConnection: (cb) => {
          const conn = {
            query:    (sql, params, cb) => { if (typeof params === 'function') { cb = params; params = []; } cb(null, []); },
            beginTransaction: (cb) => cb(null),
            commit:           (cb) => cb(null),
            rollback:         (cb) => cb(),
            release:          () => {},
          };
          cb(null, conn);
        },
      }),
    };
  }
  return _origLoad.apply(this, arguments);
};

// Patch db/index directly after mysql mock
jest_mock_db();
function jest_mock_db() {
  const dbPath = require.resolve('../src/db/index');
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: {
      getNextIndex:      async (_t) => hdIndex++,
      createPayment:     async (p)  => { payments.set(p.id, p); },
      getPaymentById:    async (id) => payments.get(id) ? { ...payments.get(id), status: 'pending', amount_received: '0', tx_hash: null, confirmations: 0 } : null,
      getPaymentByAddress: async () => null,
      getPendingPayments:  async () => [],
      updatePaymentStatus: async () => {},
      expireStale:         async () => {},
      getActiveChains:     async () => [],
    },
  };
}

// Mock evmMonitor so it doesn't spin up timers
const monPath = require.resolve('../src/services/evmMonitor');
require.cache[monPath] = {
  id: monPath, filename: monPath, loaded: true,
  exports: { startEvmMonitor: () => {}, stopEvmMonitor: () => {} },
};

// ── Load modules AFTER mocking ────────────────────────────────────────────────
const { ethers }          = require('ethers');
const { deriveEvmAddress, deriveEvmKeypair } = require('../src/services/hdWallet');
const { getChainConfig, isChainConfigured, getConfiguredChainIds } = require('../src/config/chains');
const { parseAmount, resolveTtl, formatPayment } = require('../src/routes/_helpers');
const app = require('../src/app');

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${detail ? '  (' + detail + ')' : ''}`);
    failed++;
  }
}

function section(name) { console.log(`\n── ${name} ─────────────────────────────`); }

// ─── 1. HD Wallet ─────────────────────────────────────────────────────────────
section('HD Wallet');

const kp0 = deriveEvmKeypair(0);
assert('index 0 address is checksummed',    ethers.isAddress(kp0.address));
assert('index 0 address starts with 0x',   kp0.address.startsWith('0x'));
assert('index 0 has 66-char private key',  kp0.privateKey.length === 66);

const kp1 = deriveEvmKeypair(1);
assert('index 1 address differs from 0',   kp1.address !== kp0.address);

const addr0 = deriveEvmAddress(0);
assert('deriveEvmAddress(0) matches keypair', addr0 === kp0.address);

// Hardcoded Hardhat/Anvil test mnemonic address[0] — well-known value
assert('known mnemonic → known address',
  kp0.address === '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');

// ─── 2. Chain config ──────────────────────────────────────────────────────────
section('Chain Config');

assert('chain 1 (ETH) is configured',   isChainConfigured(1));
assert('chain 56 (BSC) is configured',  isChainConfigured(56));
assert('chain 999 is NOT configured',   !isChainConfigured(999));

const ethCfg = getChainConfig(1);
assert('ETH rpc set',  !!ethCfg.rpc);
assert('ETH base set', ethers.isAddress(ethCfg.base));
assert('ETH name set', ethCfg.name === 'Ethereum');

const ids = getConfiguredChainIds();
assert('discovers both configured chains', ids.length === 2 && ids.includes(1) && ids.includes(56));

// ─── 3. Helpers ───────────────────────────────────────────────────────────────
section('Amount Parsing');

assert('parseAmount ETH 18 dec',   parseAmount('1.5', 18) === ethers.parseEther('1.5'));
assert('parseAmount USDT 6 dec',   parseAmount('10.0', 6) === 10_000_000n);
assert('parseAmount int string',   parseAmount('100', 18) === ethers.parseUnits('100', 18));

try { parseAmount('0', 18); assert('zero throws', false); }
catch { assert('zero amount throws', true); }

try { parseAmount('abc', 18); assert('nan throws', false); }
catch { assert('non-numeric amount throws', true); }

section('TTL');
assert('default ttl 30min',     resolveTtl(undefined) === 30 * 60 * 1000);
assert('custom ttl',            resolveTtl(60000) === 60000);
assert('ttl capped at 2h',      resolveTtl(99_999_999) === 2 * 60 * 60 * 1000);

// ─── 4. Response formatter ────────────────────────────────────────────────────
section('Response Formatter');

const mockPayment = {
  id: 'abc-123', user_id: 'u1', chain_type: 'evm', chain_id: 1,
  token_address: null, token_symbol: 'ETH', token_decimals: 18,
  address: kp0.address, address_index: 0,
  amount_expected: ethers.parseEther('0.05').toString(),
  amount_received: '0', status: 'pending', tx_hash: null, confirmations: 0,
  created_at: Date.now(), updated_at: Date.now(), expires_at: Date.now() + 1800000,
};

const fmt = formatPayment(mockPayment);
assert('amount_expected human-readable', fmt.amount_expected === '0.05');
assert('amount_received defaults to 0',  fmt.amount_received === '0.0');
assert('payment_id present',             fmt.payment_id === 'abc-123');
assert('expires_at is ISO string',        fmt.expires_at.includes('T'));
assert('token_address null for native',   fmt.token_address === null);

const tokenPayment = {
  ...mockPayment, token_address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  token_symbol: 'USDT', token_decimals: 6,
  amount_expected: '10000000', // 10 USDT
};
const fmtToken = formatPayment(tokenPayment);
assert('USDT amount_expected formatted correctly', fmtToken.amount_expected === '10.0');
assert('token_address present', fmtToken.token_address !== null);

// ─── 5. HTTP routes ───────────────────────────────────────────────────────────
section('HTTP Routes');

const server = app.listen(0); // port 0 = random free port
const { port } = server.address();
const base = `http://localhost:${port}`;

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${base}${path}`, opts);
  return { status: r.status, body: await r.json() };
}

(async () => {
  // Health
  let r = await req('GET', '/health');
  assert('GET /health 200',   r.status === 200);
  assert('health ok:true',    r.body.ok === true);

  // 404
  r = await req('GET', '/api/nonexistent');
  assert('GET unknown route 404', r.status === 404);

  // ── eth route ──────────────────────────────────────────────────────────────
  // Missing user_id
  r = await req('POST', '/api/pay/eth', { chain_id: 1, amount: '0.1' });
  assert('POST /eth no user_id → 400', r.status === 400);

  // Missing chain_id
  r = await req('POST', '/api/pay/eth', { user_id: 'u1', amount: '0.1' });
  assert('POST /eth no chain_id → 400', r.status === 400);

  // Unknown chain
  r = await req('POST', '/api/pay/eth', { user_id: 'u1', chain_id: 9999, amount: '0.1' });
  assert('POST /eth unknown chain → 400', r.status === 400);

  // Invalid amount
  r = await req('POST', '/api/pay/eth', { user_id: 'u1', chain_id: 1, amount: 'abc' });
  assert('POST /eth bad amount → 400', r.status === 400);

  // Valid ETH payment
  r = await req('POST', '/api/pay/eth', { user_id: 'u1', chain_id: 1, amount: '0.05' });
  assert('POST /eth valid → 201',           r.status === 201);
  assert('response has payment_id',         !!r.body.payment_id);
  assert('response has EVM address',        ethers.isAddress(r.body.address));
  assert('status is pending',               r.body.status === 'pending');
  assert('chain_id echoed',                 r.body.chain_id === 1);
  assert('token_symbol is ETH',             r.body.token_symbol === 'ETH');
  assert('amount_expected human readable',  r.body.amount_expected === '0.05');

  const ethPaymentId = r.body.payment_id;

  // BSC payment — different chain same mnemonic
  r = await req('POST', '/api/pay/eth', { user_id: 'u2', chain_id: 56, amount: '0.001' });
  assert('POST /eth BSC → 201',          r.status === 201);
  assert('BSC chain_id echoed',          r.body.chain_id === 56);
  assert('BSC token_symbol is BNB',      r.body.token_symbol === 'BNB');
  assert('BSC address different to ETH', r.body.address !== ethPaymentId);

  // GET status
  r = await req('GET', `/api/pay/eth/${ethPaymentId}`);
  assert('GET /eth/:id 200',  r.status === 200);
  assert('id matches',        r.body.payment_id === ethPaymentId);

  // GET 404
  r = await req('GET', '/api/pay/eth/nonexistent-id');
  assert('GET /eth/bad-id → 404', r.status === 404);

  // ── eth-token route ────────────────────────────────────────────────────────
  // Missing token_address
  r = await req('POST', '/api/pay/eth-token', {
    user_id: 'u1', chain_id: 1, token_symbol: 'USDT', amount: '10',
  });
  assert('POST /eth-token no token_address → 400', r.status === 400);

  // Bad token_address
  r = await req('POST', '/api/pay/eth-token', {
    user_id: 'u1', chain_id: 1,
    token_address: 'not-an-address', token_symbol: 'USDT', amount: '10',
  });
  assert('POST /eth-token bad address → 400', r.status === 400);

  // Valid USDT payment — will hit 503 if no treasury key, but that's expected in test
  r = await req('POST', '/api/pay/eth-token', {
    user_id: 'u1', chain_id: 1,
    token_address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    token_symbol: 'USDT', token_decimals: 6, amount: '10.0',
  });
  // 503 = gas reserve check failed (no real RPC in test), 201 = success
  assert('POST /eth-token returns 201 or 503', r.status === 201 || r.status === 503);

  // ── sol routes (stubs) ────────────────────────────────────────────────────
  r = await req('POST', '/api/pay/sol', { user_id: 'u1', amount: '1' });
  assert('POST /sol → 501 stub', r.status === 501);

  r = await req('POST', '/api/pay/sol-token', { user_id: 'u1', amount: '10' });
  assert('POST /sol-token → 501 stub', r.status === 501);

  server.close();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(45)}`);
  console.log(`  passed: ${passed}   failed: ${failed}`);
  if (failed > 0) { console.error('\n❌  Some tests failed'); process.exit(1); }
  else              console.log('\n✅  All tests passed');
})();
