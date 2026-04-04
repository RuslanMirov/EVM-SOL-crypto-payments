/**
 * scripts/test-rpc-balance.js
 *
 * Quick test: fetch native balance via HTTP JSON-RPC.
 *
 * Usage: node scripts/test-rpc-balance.js
 */

// ──────────────────────────────────────────────
//  EDIT THESE TWO VALUES BEFORE RUNNING
// ──────────────────────────────────────────────
const rpc     = 'https://ethereum-sepolia-rpc.publicnode.com';
const address = '0x62b397afd9DFb2166C57323Fa3bBeaAceeCb3460';

async function getBalance(rpc, address) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getBalance',
    params: [address, 'latest'],
  });

  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();

  if (json.error) {
    throw new Error(`RPC error: ${json.error.message}`);
  }

  return json.result;
}

(async () => {
  console.log(`RPC:     ${rpc}`);
  console.log(`Address: ${address}`);
  console.log('---');

  try {
    const hexBalance = await getBalance(rpc, address);
    const wei        = BigInt(hexBalance);
    const eth        = Number(wei) / 1e18;

    console.log(`Hex:     ${hexBalance}`);
    console.log(`Wei:     ${wei.toString()}`);
    console.log(`ETH:     ${eth}`);
  } catch (err) {
    console.error(`ERROR:   ${err.message}`);
    process.exit(1);
  }
})();
