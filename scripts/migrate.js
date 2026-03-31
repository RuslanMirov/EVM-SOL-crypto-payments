/**
 * scripts/migrate.js
 *
 * Usage:
 *   node scripts/migrate.js
 *
 * Reads schema.sql and executes each statement against the configured MySQL DB.
 * Safe to run multiple times (all statements use CREATE/INSERT … IF NOT EXISTS / IGNORE).
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const mysql = require('mysql');

const conn = mysql.createConnection({
  host:     process.env.DB_HOST     || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT || '3306', 10),
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'crypto_pay',
  multipleStatements: true,
});

const sql = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');

conn.connect(err => {
  if (err) { console.error('DB connection failed:', err.message); process.exit(1); }

  conn.query(sql, (err) => {
    conn.end();
    if (err) { console.error('Migration failed:', err.message); process.exit(1); }
    console.log('✅  Migration complete');
  });
});
