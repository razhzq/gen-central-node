-- GEN_020: Asset Owner Requests - External asset owners can request to onboard

CREATE TABLE asset_owner_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_name TEXT,
    contact_email TEXT NOT NULL,
    message TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_asset_owner_requests_user_id ON asset_owner_requests(user_id);
CREATE INDEX idx_asset_owner_requests_status ON asset_owner_requests(status);
CREATE INDEX idx_asset_owner_requests_created_at ON asset_owner_requests(created_at DESC);

-- eNDA (Electronic Non-Disclosure Agreement) for makers
-- Stores signed NDAs with signature data

CREATE TABLE IF NOT EXISTS user_ndas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  counterparty_legal_name TEXT NOT NULL,
  counterparty_address TEXT NOT NULL,
  signer_full_name TEXT NOT NULL,
  signature_data TEXT NOT NULL,
  signed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_ndas_user_id ON user_ndas(user_id);

-- Add nda_signed flag to users table for quick lookup
ALTER TABLE users ADD COLUMN IF NOT EXISTS nda_signed BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nda_signed_at TIMESTAMP WITH TIME ZONE;
