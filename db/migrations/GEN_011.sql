-- Add category enum type for investment categories
CREATE TYPE site_category_enum AS ENUM (
  'SOLAR',
  'EV',
  'EE'
);

-- Add category column to sites table
ALTER TABLE sites 
ADD COLUMN category site_category_enum;

-- Update existing Puchong site to be categorized as SOLAR
UPDATE sites 
SET category = 'SOLAR' 
WHERE name = 'Puchong';
