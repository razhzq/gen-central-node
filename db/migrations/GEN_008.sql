CREATE TABLE energy_computation_runs (
  id UUID PRIMARY KEY,
  meter_id UUID NOT NULL,

  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,

  computation_type energy_computation_type_enum NOT NULL,
  method energy_computation_method_enum NOT NULL,

  sample_count INT NOT NULL,
  energy_wh BIGINT NOT NULL,

  source_batch_start UUID,
  source_batch_end UUID,

  computed_at TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT fk_energy_meter
    FOREIGN KEY (meter_id)
    REFERENCES meters(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_energy_batch_start
    FOREIGN KEY (source_batch_start)
    REFERENCES telemetry_batches(id),

  CONSTRAINT fk_energy_batch_end
    FOREIGN KEY (source_batch_end)
    REFERENCES telemetry_batches(id),

  CONSTRAINT chk_energy_period
    CHECK (period_end > period_start)
);
