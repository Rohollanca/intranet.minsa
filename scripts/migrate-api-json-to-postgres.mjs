import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL es requerido para migrar datos a PostgreSQL.');
  process.exit(1);
}

const clientsPath = process.env.API_CLIENTS_PATH || join(process.cwd(), 'data', 'api-clients.json');
const usagePath = process.env.API_USAGE_LOG_PATH || join(process.cwd(), 'data', 'api-usage.log');

const hashKey = (apiKey) => createHash('sha256').update(String(apiKey)).digest('hex');
const previewKey = (apiKey) => `${String(apiKey).slice(0, 12)}...${String(apiKey).slice(-4)}`;

const readJsonStore = () => {
  if (!existsSync(clientsPath)) return { plans: [], clients: [], subscriptions: [] };
  const data = JSON.parse(readFileSync(clientsPath, 'utf8'));
  return {
    plans: Array.isArray(data.plans) ? data.plans : [],
    clients: Array.isArray(data.clients) ? data.clients : [],
    subscriptions: Array.isArray(data.subscriptions) ? data.subscriptions : [],
  };
};

const readUsageLog = () => {
  if (!existsSync(usagePath)) return [];
  return readFileSync(usagePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

const data = readJsonStore();
const usage = readUsageLog();

const client = await pool.connect();
try {
  await client.query('BEGIN');

  for (const plan of data.plans) {
    await client.query(`
      INSERT INTO api_plans (id, name, requests_per_minute, daily_credits, document_limit_daily, permissions)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        requests_per_minute = EXCLUDED.requests_per_minute,
        daily_credits = EXCLUDED.daily_credits,
        document_limit_daily = EXCLUDED.document_limit_daily,
        permissions = EXCLUDED.permissions
    `, [
      plan.id,
      plan.name,
      Number(plan.requestsPerMinute || 60),
      Number(plan.dailyCredits || 50),
      Number(plan.documentLimitDaily || 0),
      JSON.stringify(plan.permissions || []),
    ]);
  }

  for (const apiClient of data.clients) {
    const apiKeyHash = apiClient.apiKeyHash || (apiClient.apiKey ? hashKey(apiClient.apiKey) : null);
    if (!apiKeyHash) {
      console.warn(`Cliente omitido sin apiKey/apiKeyHash: ${apiClient.id || apiClient.name}`);
      continue;
    }

    await client.query(`
      INSERT INTO api_keys (
        id, client_name, api_key_hash, api_key_preview, plan_id, active,
        daily_credits, remaining_credits, last_recharge, permissions, created_at, revoked_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::jsonb, COALESCE($11::timestamptz, now()), $12::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        client_name = EXCLUDED.client_name,
        api_key_hash = EXCLUDED.api_key_hash,
        api_key_preview = EXCLUDED.api_key_preview,
        plan_id = EXCLUDED.plan_id,
        active = EXCLUDED.active,
        daily_credits = EXCLUDED.daily_credits,
        remaining_credits = EXCLUDED.remaining_credits,
        last_recharge = EXCLUDED.last_recharge,
        permissions = EXCLUDED.permissions,
        revoked_at = EXCLUDED.revoked_at
    `, [
      apiClient.id,
      apiClient.name,
      apiKeyHash,
      apiClient.apiKeyPreview || (apiClient.apiKey ? previewKey(apiClient.apiKey) : 'hash-only'),
      apiClient.planId || 'basic',
      apiClient.active !== false,
      Number(apiClient.dailyCredits || 50),
      Number(apiClient.remainingCredits || 0),
      apiClient.lastRecharge || new Date().toISOString().slice(0, 10),
      JSON.stringify(apiClient.permissions || []),
      apiClient.createdAt || null,
      apiClient.revokedAt || null,
    ]);
  }

  for (const subscription of data.subscriptions) {
    await client.query(`
      INSERT INTO api_subscriptions (id, api_key_id, plan_id, status, starts_at, ends_at, billing_reference)
      VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6::timestamptz, $7)
      ON CONFLICT (id) DO UPDATE SET
        api_key_id = EXCLUDED.api_key_id,
        plan_id = EXCLUDED.plan_id,
        status = EXCLUDED.status,
        starts_at = EXCLUDED.starts_at,
        ends_at = EXCLUDED.ends_at,
        billing_reference = EXCLUDED.billing_reference
    `, [
      subscription.id,
      subscription.apiKeyId,
      subscription.planId,
      subscription.status || 'active',
      subscription.startsAt || null,
      subscription.endsAt || null,
      subscription.billingReference || null,
    ]);
  }

  for (const entry of usage) {
    await client.query(`
      INSERT INTO api_usage_logs (
        api_key_id, client_name, event, endpoint, method, ip_address,
        status_code, response_time_ms, request_summary, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, COALESCE($10::timestamptz, now()))
    `, [
      entry.clientId || null,
      entry.clientName || null,
      entry.event || 'request',
      entry.endpoint || entry.event || 'unknown',
      entry.method || null,
      entry.ip || null,
      Number(entry.status || entry.statusCode || 200),
      Number(entry.responseTimeMs || 0),
      JSON.stringify(entry.request || entry.details || {}),
      entry.ts || null,
    ]);
  }

  await client.query('COMMIT');
  console.log(`Migracion completada: ${data.clients.length} clientes, ${data.plans.length} planes, ${data.subscriptions.length} suscripciones, ${usage.length} logs.`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
