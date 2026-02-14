-- GEN_022: Organization color theme for white-label branding

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS theme_colors JSONB DEFAULT '{}';
