CREATE TABLE sites (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT fk_sites_organization
    FOREIGN KEY (organization_id)
    REFERENCES organizations(id)
    ON DELETE CASCADE
);
