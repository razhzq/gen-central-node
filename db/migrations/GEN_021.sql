-- GEN_021: Asset onboarding flow — console-first visibility, tokenization gate, org branding
--
-- Changes:
-- 1. Flip default visibility: assets start hidden, system controls visibility
-- 2. Add tokenization tracking to sites
-- 3. Add branding fields to organizations
-- 4. Add organization_id to users (maker-to-org link)

-- ============================================================
-- 1. Flip visibility defaults on sites
-- ============================================================
ALTER TABLE sites ALTER COLUMN show_in_invest SET DEFAULT false;
ALTER TABLE sites ALTER COLUMN show_in_console SET DEFAULT false;

-- ============================================================
-- 2. Tokenization tracking on sites
-- ============================================================
DO $$ BEGIN
    CREATE TYPE tokenization_status_enum AS ENUM ('none', 'pending', 'approved', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE sites ADD COLUMN IF NOT EXISTS is_tokenized BOOLEAN DEFAULT false;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS tokenized_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS token_contract_address TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS tokenization_status tokenization_status_enum DEFAULT 'none';

CREATE INDEX IF NOT EXISTS idx_sites_is_tokenized ON sites(is_tokenized) WHERE is_tokenized = true;
CREATE INDEX IF NOT EXISTS idx_sites_tokenization_status ON sites(tokenization_status);

-- ============================================================
-- 3. Organization branding fields
-- ============================================================
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- ============================================================
-- 4. Link users to organizations
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id);

-- ============================================================
-- 5. Fix existing data: active sites should be visible in console
-- ============================================================
UPDATE sites SET show_in_console = true WHERE status = 'active';
