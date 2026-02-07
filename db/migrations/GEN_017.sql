-- GEN_017: Add image_urls (multiple images / base64) to sites table

ALTER TABLE sites ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN sites.image_urls IS 'Array of image URLs or base64 data URLs. image_url holds the first for backward compatibility.';
