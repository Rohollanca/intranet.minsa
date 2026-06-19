-- Plataforma API comercial - PostgreSQL
-- Ejecutar antes de iniciar produccion:
-- psql "$DATABASE_URL" -f migrations/001_api_platform.sql

CREATE TABLE IF NOT EXISTS api_plans (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  requests_per_minute INTEGER NOT NULL DEFAULT 60,
  daily_credits INTEGER NOT NULL DEFAULT 50,
  document_limit_daily INTEGER NOT NULL DEFAULT 0,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id VARCHAR(40) PRIMARY KEY,
  client_name VARCHAR(160) NOT NULL,
  api_key_hash CHAR(64) NOT NULL UNIQUE,
  api_key_preview VARCHAR(40) NOT NULL,
  plan_id VARCHAR(40) NOT NULL REFERENCES api_plans(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  daily_credits INTEGER NOT NULL DEFAULT 50,
  remaining_credits INTEGER NOT NULL DEFAULT 50,
  last_recharge DATE NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS api_subscriptions (
  id VARCHAR(40) PRIMARY KEY,
  api_key_id VARCHAR(40) NOT NULL REFERENCES api_keys(id),
  plan_id VARCHAR(40) NOT NULL REFERENCES api_plans(id),
  status VARCHAR(40) NOT NULL DEFAULT 'active',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NULL,
  billing_reference VARCHAR(160) NULL
);

CREATE TABLE IF NOT EXISTS api_rate_limits (
  id VARCHAR(80) PRIMARY KEY,
  api_key_id VARCHAR(40) NOT NULL REFERENCES api_keys(id),
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS api_usage_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  api_key_id VARCHAR(40) NULL REFERENCES api_keys(id),
  client_name VARCHAR(160) NULL,
  event VARCHAR(80) NOT NULL DEFAULT 'request',
  endpoint VARCHAR(180) NOT NULL,
  method VARCHAR(12) NULL,
  ip_address VARCHAR(80) NULL,
  status_code INTEGER NOT NULL DEFAULT 200,
  response_time_ms INTEGER NOT NULL DEFAULT 0,
  request_summary JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_logs_created_at ON api_usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_api_key_id ON api_usage_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_endpoint ON api_usage_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_key_window ON api_rate_limits(api_key_id, window_start);

INSERT INTO api_plans (id, name, requests_per_minute, daily_credits, document_limit_daily, permissions) VALUES
('free', 'Plan gratuito', 20, 10, 0, '["saldo","consulta_demo"]'::jsonb),
('basic', 'Plan basico', 60, 50, 25, '["saldo","consulta_demo","pacientes","consultas"]'::jsonb),
('professional', 'Plan profesional', 120, 250, 100, '["saldo","consulta_demo","pacientes","consultas","documentos"]'::jsonb),
('enterprise', 'Plan empresarial', 300, 1000, 500, '["saldo","consulta_demo","pacientes","consultas","documentos","admin_integracion"]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  requests_per_minute = EXCLUDED.requests_per_minute,
  daily_credits = EXCLUDED.daily_credits,
  document_limit_daily = EXCLUDED.document_limit_daily,
  permissions = EXCLUDED.permissions;
