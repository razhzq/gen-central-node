-- GEN_018: Add contract_due_date for contract end date (replaces contract term text)

ALTER TABLE sites ADD COLUMN IF NOT EXISTS contract_due_date DATE;

COMMENT ON COLUMN sites.contract_due_date IS 'Contract end date. Used to show remaining active duration on asset detail page.';
