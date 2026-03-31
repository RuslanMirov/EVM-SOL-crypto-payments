/**
 * src/config/evmProvider.js
 *
 * Lazily creates and caches one ethers.JsonRpcProvider per chain ID.
 * Import getProvider(chainId) everywhere instead of constructing providers.
 */

const { ethers }         = require('ethers');
const { getChainConfig } = require('./chains');

const _providers = new Map();

function getProvider(chainId) {
  const id = Number(chainId);
  if (_providers.has(id)) return _providers.get(id);

  const { rpc } = getChainConfig(id);
  const provider = new ethers.JsonRpcProvider(rpc);
  _providers.set(id, provider);
  return provider;
}

module.exports = { getProvider };
