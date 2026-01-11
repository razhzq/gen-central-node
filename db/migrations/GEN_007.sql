CREATE TABLE telemetry_metrics (
  id BIGSERIAL PRIMARY KEY,
  meter_id UUID NOT NULL,
  batch_id UUID,

  metric TEXT NOT NULL,
  value NUMERIC NOT NULL,
  unit TEXT NOT NULL,

  recorded_at TIMESTAMP NOT NULL,

  CONSTRAINT fk_metrics_meter
    FOREIGN KEY (meter_id)
    REFERENCES meters(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_metrics_batch
    FOREIGN KEY (batch_id)
    REFERENCES telemetry_batches(id)
    ON DELETE SET NULL
);
