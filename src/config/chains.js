/**
 * src/config/chains.js
 *
 * Resolves EVM chain configuration from environment variables.
 *
 * Convention in .env:
 *   EVM_CHAIN_{chainId}_RPC   — JSON-RPC endpoint
 *   EVM_CHAIN_{chainId}_BASE  — treasury address (receives swept funds)
 *   EVM_CHAIN_{chainId}_NAME  — human label (optional, for logs)
 *
 * Supported chains are auto-discovered from env — just add variables for a new chain.
 *
 * Known chain IDs for reference:
 *   1    — Ethereum mainnet
 *   56   — BNB Smart Chain
 *   137  — Polygon
 *   42161 — Arbitrum One
 *   10   — Optimism
 *   8453 — Base
 *   43114 — Avalanche C-Chain
 */

require('dotenv').config();

const _cache = new Map();

/**
 * Returns { rpc, base, name } for a given numeric chainId.
 * Throws if the chain is not configured.
 */
function getChainConfig(chainId) {
  const id = Number(chainId);

  if (_cache.has(id)) return _cache.get(id);

  const rpc  = process.env[`EVM_CHAIN_${id}_RPC`];
  const base = process.env[`EVM_CHAIN_${id}_BASE`];
  const name = process.env[`EVM_CHAIN_${id}_NAME`] || `Chain ${id}`;

  if (!rpc)  throw new Error(`EVM_CHAIN_${id}_RPC not configured`);
  if (!base) throw new Error(`EVM_CHAIN_${id}_BASE not configured`);

  const cfg = { rpc, base, name, chainId: id };
  _cache.set(id, cfg);
  return cfg;
}

/**
 * Returns all configured chain IDs (discovered from env keys).
 */
function getConfiguredChainIds() {
  return Object.keys(process.env)
    .map(k => k.match(/^EVM_CHAIN_(\d+)_RPC$/))
    .filter(Boolean)
    .map(m => Number(m[1]));
}

/**
 * Validate that a chain is configured — use at request time to return a clean 400.
 */
function isChainConfigured(chainId) {
  try { getChainConfig(chainId); return true; }
  catch { return false; }
}

module.exports = { getChainConfig, getConfiguredChainIds, isChainConfigured };
