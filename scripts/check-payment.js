#!/usr/bin/env node
const BASE       = 'http://localhost:3001';
const PAYMENT_ID = '315ef03f-69ff-4a23-a8c7-975e87146b79';

async function main() {
  const res = await fetch(`${BASE}/api/pay/eth/${PAYMENT_ID}`);
  const data = await res.json();
  if (!res.ok) { console.error('Error:', data.error); process.exit(1); }

  const paid = ['confirmed', 'claimed'].includes(data.status);

  console.log(`\nPayment ${data.payment_id}`);
  console.log(`  Status       : ${data.status}`);
  console.log(`  Expected     : ${data.amount_expected} ${data.token_symbol}`);
  console.log(`  Received     : ${data.amount_received} ${data.token_symbol}`);
  console.log(`  Address      : ${data.address}`);
  console.log(`  Tx hash      : ${data.tx_hash || 'none'}`);
  console.log(`  Confirmations: ${data.confirmations}`);
  console.log(`\n  Result: ${paid ? 'PAID' : data.status === 'expired' ? 'EXPIRED' : 'WAITING'}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
