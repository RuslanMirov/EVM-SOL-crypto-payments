-- crypto_pay schema
-- Run once:  mysql -u root -p crypto_pay < schema.sql

CREATE TABLE IF NOT EXISTS payments (
  id              VARCHAR(36)   NOT NULL PRIMARY KEY,
  user_id         VARCHAR(255)  NOT NULL,

  -- chain identification
  chain_type      ENUM('evm','sol') NOT NULL,          -- 'evm' or 'sol'
  chain_id        INT           NULL,                  -- EVM chain ID: 1=ETH, 56=BSC, 137=MATIC …
  token_address   VARCHAR(100)  NULL,                  -- NULL = native asset; contract address for tokens
  token_symbol    VARCHAR(20)   NOT NULL,              -- ETH | BNB | MATIC | USDT | USDC …
  token_decimals  TINYINT       NOT NULL DEFAULT 18,

  -- deposit address (HD-derived, unique per payment)
  address         VARCHAR(100)  NOT NULL UNIQUE,
  address_index   INT           NOT NULL,

  -- amounts stored as decimal strings to avoid float precision issues
  amount_expected VARCHAR(78)   NOT NULL,              -- in smallest unit (wei / lamport)
  amount_received VARCHAR(78)   NOT NULL DEFAULT '0',

  -- lifecycle
  status          ENUM('pending','confirming','confirmed','claimed','expired','failed')
                                NOT NULL DEFAULT 'pending',
  tx_hash         VARCHAR(100)  NULL,
  confirmations   INT           NOT NULL DEFAULT 0,

  created_at      BIGINT        NOT NULL,              -- unix ms
  updated_at      BIGINT        NOT NULL,
  expires_at      BIGINT        NOT NULL,

  INDEX idx_status       (status),
  INDEX idx_user         (user_id),
  INDEX idx_address      (address),
  INDEX idx_chain        (chain_type, chain_id),
  INDEX idx_pending_poll (status, chain_type, chain_id, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── HD counters ─────────────────────────────────────────────────────────────
-- One row per derivation family; atomically incremented per payment.
CREATE TABLE IF NOT EXISTS hd_counters (
  chain_type  VARCHAR(10)  NOT NULL PRIMARY KEY,  -- 'evm' | 'sol'
  next_index  INT          NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO hd_counters (chain_type, next_index) VALUES ('evm', 0);
INSERT IGNORE INTO hd_counters (chain_type, next_index) VALUES ('sol', 0);
