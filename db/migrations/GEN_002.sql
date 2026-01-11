CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  org_type org_type_enum NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
