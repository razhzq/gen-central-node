-- GEN_026: Asset Edit Requests (Maker-Checker pattern for asset edits)
CREATE TABLE IF NOT EXISTS asset_edit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id),
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  proposed_changes JSONB NOT NULL,
  original_values JSONB NOT NULL,
  reviewed_by TEXT,
  review_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
