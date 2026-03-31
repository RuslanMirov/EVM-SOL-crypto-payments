/**
 * src/routes/sol-token.js
 *
 * SPL token payments (SOL-chain equivalent of ERC-20).
 *
 * POST /api/pay/sol-token
 * Body: {
 *   user_id:       string   required
 *   token_mint:    string   required   SPL token mint address (base58)
 *   token_symbol:  string   required   e.g. "USDT"
 *   token_decimals:number   optional   default 6 for most SPL stablecoins
 *   amount:        string   required   human-readable amount
 *   ttl_ms?:       number   optional
 * }
 *
 * ── Implementation notes ─────────────────────────────────────────────────────
 * 1. Install:  npm install @solana/web3.js @solana/spl-token ed25519-hd-key tweetnacl
 *
 * 2. Deposit address = the deposit keypair's ASSOCIATED TOKEN ACCOUNT for the mint.
 *    Use getOrCreateAssociatedTokenAccount() to derive it.
 *    The deposit keypair must be funded with ~0.002 SOL to create the ATA — same
 *    gas-reserve problem as ERC-20.  Check treasury SOL balance before creating payment.
 *
 * 3. Monitor: getTokenAccountBalance(ata) returns { uiAmount, amount }.
 *    Compare amount (u64 string) vs amount_expected.
 *
 * 4. Claim:
 *    a. Seed gas (0.002 SOL) from treasury → deposit keypair (for rent + tx fee)
 *    b. transfer() SPL tokens from deposit ATA → treasury ATA
 *    c. Close deposit ATA to reclaim rent back to treasury
 *
 * USDT on Solana mint: Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
 * USDC on Solana mint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 */

const { Router } = require('express');
const router = Router();

router.post('/', (_req, res) =>
  res.status(501).json({ error: 'SOL-token route not yet implemented — see implementation notes in routes/sol-token.js' })
);

router.get('/:id', (_req, res) =>
  res.status(501).json({ error: 'SOL-token route not yet implemented' })
);

module.exports = router;
