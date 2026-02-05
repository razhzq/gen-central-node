-- GEN_014: Admin Portal - User types, site status, and deposit requests

-- Add user_type enum
CREATE TYPE user_type_enum AS ENUM ('user', 'maker', 'checker');

-- Make organization_id nullable for admin-created assets
ALTER TABLE sites ALTER COLUMN organization_id DROP NOT NULL;

-- Add user_type column to users table with default 'user'
ALTER TABLE users ADD COLUMN user_type user_type_enum NOT NULL DEFAULT 'user';

-- Add site_status enum
CREATE TYPE site_status_enum AS ENUM ('pending', 'active', 'inactive');

-- Add status column to sites table (existing sites become 'active')
ALTER TABLE sites ADD COLUMN status site_status_enum NOT NULL DEFAULT 'active';

-- Add created_by to track who created the site (nullable for existing sites)
ALTER TABLE sites ADD COLUMN created_by UUID REFERENCES users(id);

-- Create deposit_requests table for manual deposit workflow
CREATE TABLE deposit_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_usd NUMERIC(15,2) NOT NULL CHECK (amount_usd > 0),
    receipt_path TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'approved', 'rejected')),
    notes TEXT,
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_deposit_requests_user_id ON deposit_requests(user_id);
CREATE INDEX idx_deposit_requests_status ON deposit_requests(status);
CREATE INDEX idx_deposit_requests_created_at ON deposit_requests(created_at DESC);
CREATE INDEX idx_sites_status ON sites(status);
CREATE INDEX idx_sites_created_by ON sites(created_by);
CREATE INDEX idx_users_user_type ON users(user_type);
