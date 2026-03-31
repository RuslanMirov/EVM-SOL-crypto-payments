/**
 * src/services/hdWallet.js
 *
 * BIP-44 key derivation.
 *
 * EVM  — m/44'/60'/0'/0/{index}  (coin type 60 — used by MetaMask for ALL EVM chains)
 * SOL  — m/44'/501'/{index}'/0'  (coin type 501 — ed25519, stub)
 *
 * All EVM-compatible chains (ETH, BNB, MATIC, ARB, OP, BASE …) share the same
 * derivation path because they share the same keypair format (secp256k1).
 * You use one HD wallet index space for all EVM chains.
 */

const { ethers } = require('ethers');
require('dotenv').config();

// ─── EVM ──────────────────────────────────────────────────────────────────────

let _evmRoot = null;

function _getEvmRoot() {
  if (_evmRoot) return _evmRoot;
  const mnemonic = process.env.HD_MNEMONIC;
  if (!mnemonic) throw new Error('HD_MNEMONIC not set');
  const basePath = process.env.EVM_DERIVATION_PATH || "m/44'/60'/0'/0";
  _evmRoot = ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(mnemonic),
    basePath
  );
  return _evmRoot;
}

/**
 * Derive EVM keypair at index.
 * @param {number} index
 * @returns {{ address: string, privateKey: string, path: string }}
 */
function deriveEvmKeypair(index) {
  const child = _getEvmRoot().deriveChild(index);
  return { address: child.address, privateKey: child.privateKey, path: child.path };
}

/** Address only — no private key exposure */
function deriveEvmAddress(index) {
  return deriveEvmKeypair(index).address;
}

// ─── SOL (stub) ───────────────────────────────────────────────────────────────
// Requires: npm install @solana/web3.js ed25519-hd-key tweetnacl
// Derivation path: m/44'/501'/{index}'/0'

function deriveSolKeypair(_index) {
  throw new Error('SOL derivation not yet implemented — install @solana/web3.js and ed25519-hd-key');
}

function deriveSolAddress(_index) {
  return deriveSolKeypair(_index).address;
}

module.exports = { deriveEvmKeypair, deriveEvmAddress, deriveSolKeypair, deriveSolAddress };
