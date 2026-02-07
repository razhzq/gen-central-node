-- GEN_017: Add image_urls (multiple images) to sites table

ALTER TABLE sites ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN sites.image_urls IS 'Array of image URLs (strings). image_url remains first/primary for backward compatibility.';
