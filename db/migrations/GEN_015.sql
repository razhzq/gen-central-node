-- GEN_015: Extended asset details for investment pages

-- Add detailed asset information fields to sites table
ALTER TABLE sites ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Asset summary fields
ALTER TABLE sites ADD COLUMN IF NOT EXISTS asset_type TEXT; -- e.g., "Solar Rooftop Infrastructure"
ALTER TABLE sites ADD COLUMN IF NOT EXISTS portfolio_token TEXT; -- e.g., "GENX-SOLAR"
ALTER TABLE sites ADD COLUMN IF NOT EXISTS token_price NUMERIC(15, 4) DEFAULT 1.0;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS revenue_model TEXT; -- e.g., "Power Purchase Agreement (PPA)"
ALTER TABLE sites ADD COLUMN IF NOT EXISTS estimated_annual_income NUMERIC(15, 2);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS contract_term TEXT; -- e.g., "20 Years"

-- Asset facts fields
ALTER TABLE sites ADD COLUMN IF NOT EXISTS installation_type TEXT; -- e.g., "Rooftop Solar"
ALTER TABLE sites ADD COLUMN IF NOT EXISTS technology_type TEXT; -- e.g., "Monocrystalline"
ALTER TABLE sites ADD COLUMN IF NOT EXISTS num_panels INTEGER;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS peak_power_kw NUMERIC(10, 2);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS peak_sun_hours NUMERIC(5, 2) DEFAULT 4.5;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS expected_annual_output TEXT; -- e.g., "~180 MWh"

-- Tariff information
ALTER TABLE sites ADD COLUMN IF NOT EXISTS tariff_rate NUMERIC(10, 4); -- Rate per kWh
ALTER TABLE sites ADD COLUMN IF NOT EXISTS tariff_currency TEXT DEFAULT 'USD';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS tariff_escalation NUMERIC(5, 2); -- Annual escalation %

-- Yield distribution (percentages)
ALTER TABLE sites ADD COLUMN IF NOT EXISTS yield_investor_pct NUMERIC(5, 2) DEFAULT 60;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS yield_maintenance_pct NUMERIC(5, 2) DEFAULT 10;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS yield_platform_pct NUMERIC(5, 2) DEFAULT 10;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS yield_treasury_pct NUMERIC(5, 2) DEFAULT 20;

-- Visibility controls
ALTER TABLE sites ADD COLUMN IF NOT EXISTS show_in_invest BOOLEAN DEFAULT true;  -- Show in gen-invest
ALTER TABLE sites ADD COLUMN IF NOT EXISTS show_in_console BOOLEAN DEFAULT false; -- Show in gen-console (operational sites only)

-- Create indexes for visibility filtering
CREATE INDEX IF NOT EXISTS idx_sites_show_in_invest ON sites(show_in_invest) WHERE show_in_invest = true;
CREATE INDEX IF NOT EXISTS idx_sites_show_in_console ON sites(show_in_console) WHERE show_in_console = true;
