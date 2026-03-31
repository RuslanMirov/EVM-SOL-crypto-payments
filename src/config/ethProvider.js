/**
 * src/config/ethProvider.js
 *
 * Single shared ethers JsonRpcProvider instance.
 * Import this everywhere instead of constructing new providers.
 */

const { ethers } = require('ethers');
require('dotenv').config();

let _provider = null;

function getEthProvider() {
  if (_provider) return _provider;

  const rpcUrl = process.env.ETH_RPC_URL;
  if (!rpcUrl) throw new Error('ETH_RPC_URL not set in environment');

  _provider = new ethers.JsonRpcProvider(rpcUrl);
  return _provider;
}

module.exports = { getEthProvider };
