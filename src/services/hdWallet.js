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
const { derivePath }  = require('ed25519-hd-key');
const nacl             = require('tweetnacl');
const { Keypair }      = require('@solana/web3.js');
const bip39            = require('bip39');
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

// ─── SOL ──────────────────────────────────────────────────────────────────────

let _solSeed = null;

function _getSolSeed() {
  if (_solSeed) return _solSeed;
  const mnemonic = process.env.HD_MNEMONIC;
  if (!mnemonic) throw new Error('HD_MNEMONIC not set');
  _solSeed = bip39.mnemonicToSeedSync(mnemonic);
  return _solSeed;
}

/**
 * Derive Solana keypair at index.
 * Path: m/44'/501'/{index}'/0'
 * @param {number} index
 * @returns {{ address: string, secretKey: Uint8Array, keypair: Keypair, path: string }}
 */
function deriveSolKeypair(index) {
  const seed = _getSolSeed();
  const path = `m/44'/501'/${index}'/0'`;
  const { key } = derivePath(path, seed.toString('hex'));
  const keypair = Keypair.fromSecretKey(nacl.sign.keyPair.fromSeed(key).secretKey);
  return {
    address:   keypair.publicKey.toBase58(),
    secretKey: keypair.secretKey,
    keypair,
    path,
  };
}

/** Address only — no secret key exposure */
function deriveSolAddress(index) {
  return deriveSolKeypair(index).address;
}

module.exports = { deriveEvmKeypair, deriveEvmAddress, deriveSolKeypair, deriveSolAddress };
