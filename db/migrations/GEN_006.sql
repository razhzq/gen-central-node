CREATE TABLE telemetry_raw (
  batch_id UUID PRIMARY KEY,

  -- Instantaneous Power (W)
  power_l1_w INTEGER NOT NULL,
  power_l2_w INTEGER NOT NULL,
  power_l3_w INTEGER NOT NULL,
  power_total_w INTEGER NOT NULL,

  -- Cumulative Energy Import (Wh)
  energy_imp_l1_wh BIGINT NOT NULL,
  energy_imp_l2_wh BIGINT NOT NULL,
  energy_imp_l3_wh BIGINT NOT NULL,

  -- Cumulative Energy Export (Wh)
  energy_exp_l1_wh BIGINT NOT NULL,
  energy_exp_l2_wh BIGINT NOT NULL,
  energy_exp_l3_wh BIGINT NOT NULL,

  -- Net Energy (Wh)
  energy_total_wh BIGINT NOT NULL,

  CONSTRAINT fk_raw_batch
    FOREIGN KEY (batch_id)
    REFERENCES telemetry_batches(id)
    ON DELETE CASCADE
);
