#!/usr/bin/env node
const BASE     = 'http://localhost:3001';
const USER_ID  = 'u1';
const CHAIN_ID = 11155111;
const AMOUNT   = '0.05';

async function main() {
  const res = await fetch(`${BASE}/api/pay/eth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: USER_ID, chain_id: CHAIN_ID, amount: AMOUNT }),
  });

  const data = await res.json();
  if (!res.ok) { console.error('Error:', data.error); process.exit(1); }

  console.log(`\nPayment created!`);
  console.log(`  Payment ID : ${data.payment_id}`);
  console.log(`  Send ${data.amount_expected} ${data.token_symbol} to:`);
  console.log(`  ${data.address}`);
  console.log(`  Expires: ${data.expires_at}`);
  console.log(`\nCheck status: node scripts/check-payment.js`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
