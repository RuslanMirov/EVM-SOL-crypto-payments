/**
 * src/routes/eth-usdt.js  — STUB
 *
 * ETH_USDT route notes (for when you implement):
 *
 * Payment creation guard:
 *   Before issuing a deposit address, check that ETH_BASE_ADDRESS has enough
 *   ETH to cover the gas-seed transaction (typically ~0.002–0.005 ETH buffer).
 *   If base address is dry, return 503 { error: 'insufficient_gas_reserve' }.
 *
 * Claim flow:
 *   1. Estimate gas for ERC-20 transfer (USDT transferFrom)
 *   2. Send gasNeeded ETH from base address → deposit address (gas seed tx)
 *   3. Wait for gas seed confirmation
 *   4. Send USDT from deposit address → base address
 *
 * USDT contract on mainnet: 0xdAC17F958D2ee523a2206206994597C13D831ec7
 */
const { Router } = require('express');
const router = Router();

router.post('/', (_req, res) => res.status(501).json({ error: 'ETH_USDT route not yet implemented' }));
router.get('/:id', (_req, res) => res.status(501).json({ error: 'ETH_USDT route not yet implemented' }));

module.exports = router;
