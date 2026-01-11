-- Fast batch lookups
CREATE INDEX idx_batches_meter_time
  ON telemetry_batches (meter_id, interval_start, interval_end);

-- Validator replay
CREATE INDEX idx_batches_status
  ON telemetry_batches (status);

-- Time-series analytics
CREATE INDEX idx_metrics_meter_time
  ON telemetry_metrics (meter_id, recorded_at);

-- Energy computation queries
CREATE INDEX idx_energy_meter_period
  ON energy_computation_runs (meter_id, period_start, period_end);
