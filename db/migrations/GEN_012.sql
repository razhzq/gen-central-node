-- Add sites_valuation column to sites table
ALTER TABLE sites 
ADD COLUMN sites_valuation NUMERIC(15, 2);

-- Update existing Puchong site to have 50,000 USD valuation
UPDATE sites 
SET sites_valuation = 50000.00 
WHERE name = 'Puchong';
