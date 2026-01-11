-- Organization type
CREATE TYPE org_type_enum AS ENUM (
  'BUYER',
  'ASSET_OWNER',
  'OPERATOR'
);

-- Meter asset type
CREATE TYPE meter_asset_type_enum AS ENUM (
  'AGGREGATION',
  'MONITORING_ONLY'
);

-- Telemetry batch type
CREATE TYPE telemetry_batch_type_enum AS ENUM (
  'HOURLY',
  'DAILY'
);

-- Telemetry batch status
CREATE TYPE telemetry_batch_status_enum AS ENUM (
  'RECEIVED',
  'VALIDATED',
  'REJECTED'
);

-- Energy computation method
CREATE TYPE energy_computation_method_enum AS ENUM (
  'ENERGY_DELTA',
  'POWER_INTEGRATION'
);

-- Energy computation type
CREATE TYPE energy_computation_type_enum AS ENUM (
  'IMPORT',
  'EXPORT',
  'NET'
);
