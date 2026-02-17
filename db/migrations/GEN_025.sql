-- GEN_025: Make meters.site_id nullable
-- IoT nodes self-register before an admin links them to a site.
-- The NOT NULL constraint on site_id prevented unlinked registration.
-- Also update the FK to SET NULL on site deletion (meter survives site removal).

-- Drop old FK constraint
ALTER TABLE meters DROP CONSTRAINT IF EXISTS fk_meters_site;

-- Make site_id nullable
ALTER TABLE meters ALTER COLUMN site_id DROP NOT NULL;

-- Re-add FK with SET NULL on delete (meter becomes unlinked, not deleted)
ALTER TABLE meters
  ADD CONSTRAINT fk_meters_site
    FOREIGN KEY (site_id)
    REFERENCES sites(id)
    ON DELETE SET NULL;
