/**
 * src/routes/sol.js
 *
 * Native SOL payments.
 *
 * POST /api/pay/sol
 * Body: {
 *   user_id:   string   required
 *   amount:    string   required   human-readable SOL, e.g. "0.5"
 *   ttl_ms?:   number   optional
 * }
 *
 * ── Implementation notes ─────────────────────────────────────────────────────
 * 1. Install:  npm install @solana/web3.js ed25519-hd-key tweetnacl
 *
 * 2. Derivation (in hdWallet.js):
 *    const { derivePath } = require('ed25519-hd-key');
 *    const nacl = require('tweetnacl');
 *    const seed = mnemonicToSeedSync(HD_MNEMONIC);
 *    const path = `m/44'/501'/${index}'/0'`;
 *    const { key } = derivePath(path, seed.toString('hex'));
 *    const keypair = Keypair.fromSecretKey(nacl.sign.keyPair.fromSeed(key).secretKey);
 *    // keypair.publicKey.toString() → base58 address
 *
 * 3. Monitor: use @solana/web3.js Connection.getBalance(pubkey) to check lamports.
 *    1 SOL = 1_000_000_000 lamports.
 *
 * 4. Claim: SystemProgram.transfer({ fromPubkey, toPubkey: treasury, lamports })
 *    Keep 5000 lamports as fee buffer.
 */

const { Router } = require('express');
const router = Router();

router.post('/', (_req, res) =>
  res.status(501).json({ error: 'SOL route not yet implemented — see implementation notes in routes/sol.js' })
);

router.get('/:id', (_req, res) =>
  res.status(501).json({ error: 'SOL route not yet implemented' })
);

module.exports = router;
