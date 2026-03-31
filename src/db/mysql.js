/**
 * src/db/mysql.js
 *
 * Creates a mysql connection pool and exposes:
 *   query(sql, params?)        — promisified pool.query
 *   transaction(fn)            — run fn(query) inside BEGIN/COMMIT, auto-ROLLBACK on error
 */

const mysql = require('mysql');
require('dotenv').config();

const pool = mysql.createPool({
  host:            process.env.DB_HOST            || '127.0.0.1',
  port:            parseInt(process.env.DB_PORT   || '3306', 10),
  user:            process.env.DB_USER            || 'root',
  password:        process.env.DB_PASSWORD        || '',
  database:        process.env.DB_NAME            || 'crypto_pay',
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  charset:         'utf8mb4',
  timezone:        'Z',
  // Reconnect automatically
  waitForConnections: true,
  queueLimit:      0,
});

// ─── Promisified query ────────────────────────────────────────────────────────

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    pool.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

// ─── Transaction helper ───────────────────────────────────────────────────────
// Usage:
//   const result = await transaction(async (q) => {
//     const rows = await q('SELECT ... FOR UPDATE', [id]);
//     await q('UPDATE ...', [...]);
//     return rows[0];
//   });

function transaction(fn) {
  return new Promise((resolve, reject) => {
    pool.getConnection((err, conn) => {
      if (err) return reject(err);

      const q = (sql, params = []) =>
        new Promise((res, rej) =>
          conn.query(sql, params, (e, r) => (e ? rej(e) : res(r)))
        );

      conn.beginTransaction(async (txErr) => {
        if (txErr) { conn.release(); return reject(txErr); }

        try {
          const result = await fn(q);
          conn.commit((commitErr) => {
            conn.release();
            if (commitErr) return reject(commitErr);
            resolve(result);
          });
        } catch (fnErr) {
          conn.rollback(() => { conn.release(); reject(fnErr); });
        }
      });
    });
  });
}

// ─── Healthcheck ─────────────────────────────────────────────────────────────

async function ping() {
  await query('SELECT 1');
}

module.exports = { query, transaction, ping, pool };
