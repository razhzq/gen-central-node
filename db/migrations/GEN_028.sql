-- GEN_028: Data Subscriptions, Feature Flags, and Test Meter Support

-- meter_subscriptions table
CREATE TABLE meter_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id UUID NOT NULL REFERENCES meters(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'MYR',
  receipt_path TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'pending_approval', 'active', 'rejected', 'expired')),
  rejection_reason TEXT,
  notes TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  starts_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (meter_id, year)
);

-- Indexes
CREATE INDEX idx_meter_subscriptions_meter_id ON meter_subscriptions(meter_id);
CREATE INDEX idx_meter_subscriptions_user_id ON meter_subscriptions(user_id);
CREATE INDEX idx_meter_subscriptions_status ON meter_subscriptions(status);

-- Seed platform_settings for subscription price and feature flags
INSERT INTO platform_settings (key, value) VALUES
  ('data_subscription_annual_price', '{"amount": 0, "currency": "MYR"}'),
  ('feature_flags', '{"feature_data_subscription": false, "feature_test_meter": false}')
ON CONFLICT (key) DO NOTHING;
