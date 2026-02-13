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
