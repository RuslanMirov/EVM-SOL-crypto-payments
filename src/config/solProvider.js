/**
 * src/config/solProvider.js
 *
 * Lazily creates and caches a single Solana Connection.
 * Reads SOL_RPC from env.  Returns null if not configured.
 */

const { Connection } = require('@solana/web3.js');

let _connection = null;

function getConnection() {
  if (_connection) return _connection;

  const rpc = process.env.SOL_RPC;
  if (!rpc) throw new Error('SOL_RPC not set');

  _connection = new Connection(rpc, 'confirmed');
  return _connection;
}

function isSolConfigured() {
  return !!process.env.SOL_RPC && !!process.env.SOL_TREASURY;
}

function getSolTreasury() {
  const treasury = process.env.SOL_TREASURY;
  if (!treasury) throw new Error('SOL_TREASURY not set');
  return treasury;
}

module.exports = { getConnection, isSolConfigured, getSolTreasury };
