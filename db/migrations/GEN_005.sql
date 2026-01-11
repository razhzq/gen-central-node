CREATE TABLE telemetry_batches (
  id UUID PRIMARY KEY,
  meter_id UUID NOT NULL,

  batch_type telemetry_batch_type_enum NOT NULL,

  interval_start TIMESTAMP NOT NULL,
  interval_end TIMESTAMP NOT NULL,

  device_timestamp TIMESTAMP NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT now(),

  payload_hash TEXT NOT NULL,
  signature TEXT NOT NULL,

  status telemetry_batch_status_enum NOT NULL DEFAULT 'RECEIVED',

  created_at TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT fk_batches_meter
    FOREIGN KEY (meter_id)
    REFERENCES meters(id)
    ON DELETE CASCADE,

  CONSTRAINT uq_meter_interval UNIQUE (meter_id, batch_type, interval_start, interval_end),

  CONSTRAINT chk_interval_order
    CHECK (interval_end > interval_start)
);
