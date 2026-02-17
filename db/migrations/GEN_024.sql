-- GEN_024: Add GCP KMS signing key fields to meters table
-- Enables admin (checker) to create and manage GCP KMS Ed25519 signing keys
-- directly from the admin portal without touching GCP Console.

ALTER TABLE meters
  ADD COLUMN IF NOT EXISTS gcp_key_id     TEXT,     -- Full GCP KMS key version resource name
  ADD COLUMN IF NOT EXISTS gcp_public_key TEXT,     -- Ed25519 public key PEM (cached from KMS)
  ADD COLUMN IF NOT EXISTS key_status     TEXT NOT NULL DEFAULT 'pending'
    CHECK (key_status IN ('pending', 'authorized', 'revoked'));

COMMENT ON COLUMN meters.gcp_key_id     IS 'GCP KMS key version name: projects/.../cryptoKeyVersions/1';
COMMENT ON COLUMN meters.gcp_public_key IS 'Ed25519 public key PEM cached from GCP KMS';
COMMENT ON COLUMN meters.key_status     IS 'pending = no key yet, authorized = key active, revoked = key destroyed';
