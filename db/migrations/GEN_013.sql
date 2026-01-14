-- GEN_013: Create user investment tracking tables

-- Users table - Store user account information
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  wallet_address TEXT NOT NULL UNIQUE,
  kyc_status VARCHAR(20) DEFAULT 'unverified' CHECK (kyc_status IN ('unverified', 'pending', 'verified', 'rejected')),
  available_balance NUMERIC(15, 2) DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- User investments (holdings) - Track what assets users own
CREATE TABLE user_investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  asset_category site_category_enum NOT NULL,
  site_id UUID,
  amount_usd NUMERIC(15, 2) NOT NULL CHECK (amount_usd >= 0),
  token_amount NUMERIC(20, 8),
  purchase_date TIMESTAMP NOT NULL DEFAULT now(),
  created_at TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT fk_investments_user
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_investments_site
    FOREIGN KEY (site_id)
    REFERENCES sites(id)
    ON DELETE SET NULL,

  CONSTRAINT unique_user_site 
    UNIQUE(user_id, site_id)
);

-- Transaction type enum
CREATE TYPE transaction_type_enum AS ENUM (
  'DEPOSIT',
  'WITHDRAW',
  'BUY',
  'SELL',
  'YIELD'
);

-- Transaction status enum
CREATE TYPE transaction_status_enum AS ENUM (
  'PENDING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

-- User transactions - Record all investment activities
CREATE TABLE user_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  transaction_type transaction_type_enum NOT NULL,
  asset_category site_category_enum,
  site_id UUID,
  amount_usd NUMERIC(15, 2) NOT NULL,
  status transaction_status_enum DEFAULT 'COMPLETED',
  tx_hash TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT fk_transactions_user
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_transactions_site
    FOREIGN KEY (site_id)
    REFERENCES sites(id)
    ON DELETE SET NULL
);

-- User yield history - Track yield/rewards over time
CREATE TABLE user_yield_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  investment_id UUID,
  asset_category site_category_enum NOT NULL,
  yield_amount_usd NUMERIC(15, 2) NOT NULL CHECK (yield_amount_usd >= 0),
  apy_rate NUMERIC(5, 2),
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  calculated_at TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT fk_yield_user
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_yield_investment
    FOREIGN KEY (investment_id)
    REFERENCES user_investments(id)
    ON DELETE SET NULL,

  CONSTRAINT chk_yield_period
    CHECK (period_end > period_start)
);

-- Create indexes for better query performance
CREATE INDEX idx_users_wallet_address ON users(wallet_address);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_investments_user_id ON user_investments(user_id);
CREATE INDEX idx_investments_category ON user_investments(asset_category);
CREATE INDEX idx_transactions_user_id ON user_transactions(user_id);
CREATE INDEX idx_transactions_created_at ON user_transactions(created_at DESC);
CREATE INDEX idx_yield_user_id ON user_yield_history(user_id);
CREATE INDEX idx_yield_calculated_at ON user_yield_history(calculated_at DESC);

-- Add updated_at trigger for users table
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
