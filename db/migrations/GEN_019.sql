-- GEN_019: Allow meters to be registered without a site (link site later via admin UI)

ALTER TABLE meters ALTER COLUMN site_id DROP NOT NULL;

COMMENT ON COLUMN meters.site_id IS 'Linked site (asset). NULL when registered by IoT node and not yet linked in admin.';
