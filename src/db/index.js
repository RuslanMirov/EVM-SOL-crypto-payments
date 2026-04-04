/**
 * src/db/index.js
 *
 * All database operations.  No raw SQL outside this file.
 */

const { query, transaction } = require('./mysql');

// ─── HD index ─────────────────────────────────────────────────────────────────

/**
 * Atomically get-and-increment the HD derivation index for a chain family.
 * Uses SELECT … FOR UPDATE inside a transaction so concurrent requests
 * never receive the same index.
 *
 * @param {'evm'|'sol'} chainType
 * @returns {Promise<number>}
 */
async function getNextIndex(chainType) {
  return transaction(async (q) => {
    const rows = await q(
      'SELECT next_index FROM hd_counters WHERE chain_type = ? FOR UPDATE',
      [chainType]
    );
    if (!rows.length) throw new Error(`Unknown chain_type: ${chainType}`);
    const index = rows[0].next_index;
    await q(
      'UPDATE hd_counters SET next_index = next_index + 1 WHERE chain_type = ?',
      [chainType]
    );
    return index;
  });
}

// ─── Payments ─────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   id, user_id, chain_type, chain_id, token_address, token_symbol,
 *   token_decimals, address, address_index, amount_expected,
 *   created_at, updated_at, expires_at
 * }} p
 */
async function createPayment(p) {
  await query(
    `INSERT INTO payments
      (id, user_id, chain_type, chain_id, token_address, token_symbol,
       token_decimals, address, address_index, amount_expected,
       status, created_at, updated_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`,
    [
      p.id, p.user_id, p.chain_type, p.chain_id ?? null,
      p.token_address ?? null, p.token_symbol, p.token_decimals,
      p.address, p.address_index, p.amount_expected,
      p.created_at, p.updated_at, p.expires_at,
    ]
  );
}

async function getPaymentById(id) {
  const rows = await query('SELECT * FROM payments WHERE id = ?', [id]);
  return rows[0] ?? null;
}

async function getPaymentByAddress(address) {
  const rows = await query('SELECT * FROM payments WHERE address = ?', [address]);
  return rows[0] ?? null;
}

/**
 * Returns all pending/confirming payments for a given chain that haven't expired.
 * Optionally filter by token_address (null = native asset, non-null = specific token).
 */
async function getPendingPayments({ chainType, chainId, tokenAddress, nowMs }) {
  let sql = `
    SELECT * FROM payments
    WHERE status IN ('pending','confirming')
      AND chain_type = ?
      AND expires_at > ?
  `;
  const params = [chainType, nowMs];

  if (chainId !== undefined) {
    sql += ' AND chain_id = ?';
    params.push(chainId);
  }

  if (tokenAddress !== undefined) {
    sql += tokenAddress === null
      ? ' AND token_address IS NULL'
      : ' AND token_address = ?';
    if (tokenAddress !== null) params.push(tokenAddress);
  }

  return query(sql, params);
}

/**
 * @param {{
 *   id: string,
 *   status: string,
 *   amount_received?: string|null,
 *   tx_hash?: string|null,
 *   confirmations?: number|null,
 *   updated_at: number
 * }} opts
 */
async function updatePaymentStatus(opts) {
  await query(
    `UPDATE payments
     SET status          = ?,
         amount_received = COALESCE(?, amount_received),
         tx_hash         = COALESCE(?, tx_hash),
         confirmations   = COALESCE(?, confirmations),
         updated_at      = ?
     WHERE id = ?`,
    [
      opts.status,
      opts.amount_received ?? null,
      opts.tx_hash         ?? null,
      opts.confirmations   ?? null,
      opts.updated_at,
      opts.id,
    ]
  );
}

/** Bulk-expire all pending payments past their TTL */
async function expireStale(nowMs) {
  const result = await query(
    `UPDATE payments
     SET status = 'expired', updated_at = ?
     WHERE status = 'pending' AND expires_at <= ?`,
    [nowMs, nowMs]
  );
  if (result.affectedRows > 0) {
    console.log(`[payment:expired] ${result.affectedRows} payment(s) expired`);
  }
}

/** Return all distinct (chain_type, chain_id) combos that have active payments */
async function getActiveChains() {
  return query(
    `SELECT DISTINCT chain_type, chain_id
     FROM payments
     WHERE status IN ('pending','confirming') AND expires_at > ?`,
    [Date.now()]
  );
}

// ─── Payment history ─────────────────────────────────────────────────────────

/** Return all payments for a given user, newest first. */
async function getPaymentsByUserId(userId) {
  return query(
    'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );
}

/**
 * Return a single payment matching both user_id and deposit address.
 * Used by verify-payment to confirm ownership before returning status.
 */
async function getPaymentByUserAndAddress(userId, address) {
  const rows = await query(
    'SELECT * FROM payments WHERE user_id = ? AND address = ? LIMIT 1',
    [userId, address]
  );
  return rows[0] ?? null;
}

module.exports = {
  getNextIndex,
  createPayment,
  getPaymentById,
  getPaymentByAddress,
  getPaymentsByUserId,
  getPaymentByUserAndAddress,
  getPendingPayments,
  updatePaymentStatus,
  expireStale,
  getActiveChains,
};
