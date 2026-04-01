# crypto-pay-api

Non-custodial HD-wallet payment processor with **4 flexible routes** covering any EVM chain (ETH, BNB, MATIC, ARB, OP, BASE …) and any ERC-20 token (USDT, USDC, DAI …), plus SOL and SPL token routes. Includes a universal payment status & history API.

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 18+ |
| HTTP | Express 4 |
| Database | MySQL 2 (pool + promisified helpers) |
| EVM | ethers v6 (HD wallet, providers, ERC-20) |
| HD Wallet | BIP-44 `m/44'/60'/0'/0/{index}` |

---

## Quick start

```bash
# 1. Clone / unzip, install deps
npm install

# 2. Configure
cp .env.example .env
# fill in HD_MNEMONIC, DB_*, and at least one EVM_CHAIN_*

# 3. Create the database
mysql -u root -p -e "CREATE DATABASE crypto_pay CHARACTER SET utf8mb4;"

# 4. Run migrations
node scripts/migrate.js

# 5. Start
npm start            # production
npm run dev          # nodemon watch mode
```

---

## API — Full usage flow

### Step-by-step integration

```
1. Request address  →  POST /api/pay/{eth|eth-token|sol|sol-token}
2. View status      →  GET  /api/payments/verify-payment?user_id=…&address=…
3. Get history      →  GET  /api/payments/pay-history?user_id=…
```

---

## Pay routes (create deposit address)

All routes share the same `GET /:id` response shape. `POST` creates a deposit address.

### Status lifecycle

```
pending → confirming → confirmed → claimed
        ↘ expired   (TTL passed, no funds received)
        ↘ failed    (claim error)
```

---

### `POST /api/pay/eth` — native asset on any EVM chain

```json
{
  "user_id":  "usr_123",
  "chain_id": 1,
  "amount":   "0.05",
  "ttl_ms":   1800000
}
```

| Field | Required | Notes |
|---|---|---|
| `user_id` | ✅ | Your internal user ID |
| `chain_id` | ✅ | `1`=ETH · `56`=BNB · `137`=MATIC · `42161`=ARB · `10`=OP · `8453`=BASE … |
| `amount` | ✅ | Human-readable, e.g. `"0.05"` |
| `ttl_ms` | — | Expiry in ms, max 2 h (default 30 min) |

**Response 201**
```json
{
  "payment_id":      "d24bc090-…",
  "chain_id":        1,
  "token_symbol":    "ETH",
  "address":         "0xf39F…",
  "amount_expected": "0.05",
  "expires_at":      "2024-01-01T00:30:00.000Z",
  "status":          "pending"
}
```

---

### `POST /api/pay/eth-token` — ERC-20 on any EVM chain

```json
{
  "user_id":        "usr_123",
  "chain_id":       1,
  "token_address":  "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  "token_symbol":   "USDT",
  "token_decimals": 6,
  "amount":         "10.00"
}
```

| Field | Required | Notes |
|---|---|---|
| `chain_id` | ✅ | Same chain IDs as above |
| `token_address` | ✅ | ERC-20 contract address |
| `token_symbol` | ✅ | Display label, e.g. `"USDT"` |
| `token_decimals` | — | Default `18`; USDT/USDC = `6` |

> ⚠️ **Gas reserve guard** — Returns `503 insufficient_gas_reserve` if the treasury wallet doesn't hold enough native asset to seed gas for the token sweep. Refill treasury before accepting token payments.

**Common ERC-20 addresses**

| Token | Ethereum | BSC | Polygon |
|---|---|---|---|
| USDT | `0xdAC17F…31ec7` | `0x55d398…7eb48` | `0xc2132D…b8e8F` |
| USDC | `0xA0b869…eB48` | `0x8AC76a…86b3b` | `0x2791Bc…2733e` |
| DAI | `0x6B1754…36Ae` | `0x1AF3F3…b0B4F` | `0x8f3Cf7…8fd9d` |

---

### `POST /api/pay/sol` — native SOL *(stub, 501)*

### `POST /api/pay/sol-token` — SPL token *(stub, 501)*

See `src/routes/sol.js` and `src/routes/sol-token.js` for full implementation notes.

---

### `GET /api/pay/{route}/:payment_id` — poll status

```json
{
  "payment_id":      "d24bc090-…",
  "user_id":         "usr_123",
  "chain_type":      "evm",
  "chain_id":        1,
  "token_address":   null,
  "token_symbol":    "ETH",
  "token_decimals":  18,
  "address":         "0xf39F…",
  "status":          "confirmed",
  "amount_expected": "0.05",
  "amount_received": "0.05",
  "amount_raw":      "50000000000000000",
  "tx_hash":         "0xabc…",
  "confirmations":   3,
  "expires_at":      "…"
}
```

---

## Payment view routes (universal — all chains & tokens)

All `/api/payments/*` endpoints require a Bearer token. Set the `API_BEARER_TOKEN` env var and pass it in the `Authorization` header.

---

### `GET /api/payments/pay-history` — full payment history for a user

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/payments/pay-history?user_id=usr_123"
```

**Response 200**
```json
{
  "user_id": "usr_123",
  "total": 3,
  "payments": [
    {
      "payment_id": "d24bc090-…",
      "user_id": "usr_123",
      "chain_type": "evm",
      "chain_id": 1,
      "token_address": null,
      "token_symbol": "ETH",
      "token_decimals": 18,
      "address": "0xf39F…",
      "status": "claimed",
      "amount_expected": "0.05",
      "amount_received": "0.05",
      "amount_raw": "50000000000000000",
      "tx_hash": "0xabc…",
      "confirmations": 3,
      "created_at": "2026-04-01T00:00:00.000Z",
      "updated_at": "2026-04-01T00:05:00.000Z",
      "expires_at": "2026-04-01T00:30:00.000Z"
    }
  ]
}
```

---

### `GET /api/payments/verify-payment` — check if a payment is complete

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/payments/verify-payment?user_id=usr_123&address=0xf39F…"
```

**Response 200**
```json
{
  "user_id": "usr_123",
  "address": "0xf39F…",
  "paid": true,
  "status": "claimed"
}
```

`paid` is `true` when status is `confirmed` or `claimed`, `false` otherwise.

---

## Full integration example

```bash
# 1. Request a payment address (EVM native)
curl -X POST http://localhost:3000/api/pay/eth \
  -H "Content-Type: application/json" \
  -d '{"user_id":"usr_123","chain_id":1,"amount":"0.05"}'
# → returns { "payment_id": "…", "address": "0x…", "status": "pending", … }

# 2. (User sends crypto to the address)

# 3. Verify if payment is done
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/payments/verify-payment?user_id=usr_123&address=0x…"
# → { "paid": true, "status": "claimed" }

# 4. Retrieve full payment history
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/payments/pay-history?user_id=usr_123"
# → { "total": 1, "payments": [ … ] }
```

The same flow works for all payment types — just change the POST endpoint:

| Type | Endpoint |
|---|---|
| Native EVM (ETH/BNB/MATIC…) | `POST /api/pay/eth` |
| ERC-20 token (USDT/USDC…) | `POST /api/pay/eth-token` |
| Native SOL | `POST /api/pay/sol` |
| SPL token | `POST /api/pay/sol-token` |

---

## Adding EVM chains

No code changes required — just add 3 env vars:

```env
EVM_CHAIN_42161_RPC=https://arb1.arbitrum.io/rpc
EVM_CHAIN_42161_BASE=0xYOUR_TREASURY
EVM_CHAIN_42161_NAME=Arbitrum
```

The monitor auto-discovers active chains from the DB each poll cycle.

---

## Environment variables

```env
# HD wallet (BIP-39, never commit the real one)
HD_MNEMONIC="word1 word2 … word12"

# MySQL
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=secret
DB_NAME=crypto_pay
DB_CONNECTION_LIMIT=10

# EVM chains — repeat per chain
EVM_CHAIN_{chainId}_RPC=https://…
EVM_CHAIN_{chainId}_BASE=0xTREASURY
EVM_CHAIN_{chainId}_NAME=Ethereum

# For ERC-20 token claims (seeds gas to deposit addresses)
EVM_TREASURY_PRIVATE_KEY=0x…   # private key of the treasury wallet

# Auth — required for /api/payments/* endpoints
API_BEARER_TOKEN=change-me-to-a-secure-random-string

# Monitor
POLL_INTERVAL_MS=15000
EVM_CONFIRMATIONS=2

# Server
PORT=3000
DEFAULT_TTL_MS=1800000
```

---

## Project layout

```
server.js                   Entry — HTTP server + monitor start
scripts/
  migrate.js                Run schema.sql against MySQL
  test.js                   54-assertion smoke test (no real DB/RPC needed)
schema.sql                  MySQL table definitions
src/
  app.js                    Express, route mounting
  config/
    chains.js               Resolves RPC + treasury per chain ID from env
    evmProvider.js          Cached ethers.JsonRpcProvider pool
  db/
    mysql.js                Pool, query(), transaction()
    index.js                All SQL operations
  routes/
    eth.js          ✅      Native asset, any EVM chain
    eth-token.js    ✅      ERC-20, any EVM chain
    sol.js          ✅      Native SOL
    sol-token.js    ✅      SPL token
    payments.js     ✅      Universal pay-history & verify-payment
    _helpers.js             Shared validation + formatting
  services/
    hdWallet.js             BIP-44 key derivation (EVM + SOL stub)
    evmMonitor.js           Background poll loop, all chains
    evmClaimer.js           Sweep funds → treasury (native + ERC-20)
```

---

## Token claim flow (ERC-20)

```
User sends USDT → deposit address
          ↓
Monitor detects token balance ≥ expected
          ↓
Claimer: estimate gas for transfer()
          ↓
Treasury seeds gasNeeded ETH → deposit address
          ↓
Deposit address transfers USDT → treasury
          ↓
Payment marked "claimed"
```

---

## Test

```bash
node scripts/test.js
# 54 assertions, no MySQL or RPC required
```
