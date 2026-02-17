-- GEN_023: Add latitude and longitude columns to sites table
-- These store geocoded coordinates from Google Places so gen-console can pinpoint
-- locations on the map without relying on a hardcoded dictionary.

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
