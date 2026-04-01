/**
 * scripts/migrate.js
 */
require('dotenv').config();
const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql');

const DB_NAME = process.env.DB_NAME || 'crypto_pay';

const conn = mysql.createConnection({
  host:               process.env.DB_HOST     || '127.0.0.1',
  port:               parseInt(process.env.DB_PORT || '3306', 10),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  // ← no `database` here — it may not exist yet
  multipleStatements: true,
});

const schema = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');

conn.connect(err => {
  if (err) { console.error('DB connection failed:', err.message); process.exit(1); }

  conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, err => {
    if (err) { console.error('Failed to create database:', err.message); conn.end(); process.exit(1); }
    console.log(`✅  Database \`${DB_NAME}\` ready`);

    conn.query(`USE \`${DB_NAME}\``, err => {
      if (err) { console.error('Failed to select database:', err.message); conn.end(); process.exit(1); }

      conn.query(schema, err => {
        conn.end();
        if (err) { console.error('Migration failed:', err.message); process.exit(1); }
        console.log('✅  Migration complete');
      });
    });
  });
});