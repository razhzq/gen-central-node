CREATE TABLE meters (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL,

  meter_identifier TEXT NOT NULL,
  iot_pubkey TEXT NOT NULL, -- Solana pubkey or similar

  asset_type meter_asset_type_enum NOT NULL,
  firmware_version TEXT,

  active BOOLEAN NOT NULL DEFAULT true,
  installed_at TIMESTAMP,

  CONSTRAINT fk_meters_site
    FOREIGN KEY (site_id)
    REFERENCES sites(id)
    ON DELETE CASCADE,

  CONSTRAINT uq_meter_identifier UNIQUE (meter_identifier),
  CONSTRAINT uq_meter_pubkey UNIQUE (iot_pubkey)
);
