-- Gullak backend schema.
-- Works unmodified against a local SQLite file and against Turso
-- (libSQL), since Turso is wire-compatible SQLite.
--
-- Notes on design:
--   * There is intentionally NO admin table. The single admin account
--     lives entirely in ADMIN_EMAIL / ADMIN_PASSWORD (see src/config/env.js)
--     and is checked directly on login - nothing to seed or migrate.
--   * agents/users/plans/collections use TEXT primary keys (nanoid),
--     generated in application code, so IDs are non-sequential and the
--     same code path works locally and against Turso.

CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL UNIQUE,
  account_number TEXT NOT NULL UNIQUE,
  agent_id       TEXT REFERENCES agents(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_agent_id ON users(agent_id);

-- One row per active (or past) investment - `type` decides which of the
-- type-specific columns below are populated, the rest stay NULL.
CREATE TABLE IF NOT EXISTS plans (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('daily','monthly','fixed')),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','matured','closed')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Daily Investment Plan
  daily_amount      REAL,
  daily_total_days  INTEGER,
  daily_yearly_rate REAL,

  -- Monthly Investment Plan
  monthly_total_amount   REAL,
  monthly_tenure_months  INTEGER,
  monthly_installment    REAL,
  monthly_offer_rate     REAL,

  -- Fixed Investment Plan
  fixed_amount           REAL,
  fixed_duration_months  INTEGER,
  fixed_offer_rate       REAL
);

CREATE INDEX IF NOT EXISTS idx_plans_user_id ON plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_type ON plans(type);

-- One row per daily/monthly collection event (paid or missed), marked
-- by an agent. Fixed plans don't collect, so they never appear here.
CREATE TABLE IF NOT EXISTS collections (
  id           TEXT PRIMARY KEY,
  plan_id      TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id     TEXT REFERENCES agents(id) ON DELETE SET NULL,
  amount       REAL NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('paid','missed')),
  method       TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','online')),
  collected_on TEXT NOT NULL, -- the calendar date (YYYY-MM-DD) this collection is FOR
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_collections_plan_id ON collections(plan_id);
CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_plan_date ON collections(plan_id, collected_on);

-- Short-lived OTP codes for the consumer app: one purpose for the main
-- app login, a separate purpose for the My Wallet re-verification gate.
CREATE TABLE IF NOT EXISTS otp_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  phone      TEXT NOT NULL,
  code       TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN ('login','wallet')),
  expires_at TEXT NOT NULL,
  consumed   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_otp_phone_purpose ON otp_codes(phone, purpose);
