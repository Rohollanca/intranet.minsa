-- Migracion de referencia para una base SQL de la API comercial.
-- El servidor actual usa almacenamiento JSON para no romper la app existente.
-- Cuando migres a PostgreSQL/MySQL, estas tablas cubren la estructura requerida.

CREATE TABLE api_plans (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  requests_per_minute INTEGER NOT NULL DEFAULT 60,
  daily_credits INTEGER NOT NULL DEFAULT 50,
  document_limit_daily INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE api_keys (
  id VARCHAR(40) PRIMARY KEY,
  client_name VARCHAR(160) NOT NULL,
  api_key_hash CHAR(64) NOT NULL UNIQUE,
  api_key_preview VARCHAR(40) NOT NULL,
  plan_id VARCHAR(40) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  daily_credits INTEGER NOT NULL DEFAULT 50,
  remaining_credits INTEGER NOT NULL DEFAULT 50,
  last_recharge DATE NOT NULL,
  permissions TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP NULL,
  FOREIGN KEY (plan_id) REFERENCES api_plans(id)
);

CREATE TABLE api_subscriptions (
  id VARCHAR(40) PRIMARY KEY,
  api_key_id VARCHAR(40) NOT NULL,
  plan_id VARCHAR(40) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'active',
  starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at TIMESTAMP NULL,
  billing_reference VARCHAR(160) NULL,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id),
  FOREIGN KEY (plan_id) REFERENCES api_plans(id)
);

CREATE TABLE api_rate_limits (
  id VARCHAR(40) PRIMARY KEY,
  api_key_id VARCHAR(40) NOT NULL,
  window_start TIMESTAMP NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);

CREATE TABLE api_usage_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  api_key_id VARCHAR(40) NULL,
  client_name VARCHAR(160) NULL,
  endpoint VARCHAR(180) NOT NULL,
  method VARCHAR(12) NOT NULL,
  ip_address VARCHAR(80) NULL,
  status_code INTEGER NOT NULL,
  response_time_ms INTEGER NOT NULL,
  request_summary TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);

INSERT INTO api_plans (id, name, requests_per_minute, daily_credits, document_limit_daily, permissions) VALUES
('free', 'Plan gratuito', 20, 10, 0, 'saldo,consulta_demo'),
('basic', 'Plan basico', 60, 50, 25, 'saldo,consulta_demo,pacientes,consultas'),
('professional', 'Plan profesional', 120, 250, 100, 'saldo,consulta_demo,pacientes,consultas,documentos'),
('enterprise', 'Plan empresarial', 300, 1000, 500, 'saldo,consulta_demo,pacientes,consultas,documentos,admin_integracion');
