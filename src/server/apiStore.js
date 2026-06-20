import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : String(value).split(',').map((item) => item.trim()).filter(Boolean);
    } catch {
      return String(value).split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
};

const dateOnly = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
};

const toIso = (value) => {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return value.toISOString();
};

const mapPlan = (row) => ({
  id: row.id,
  name: row.name,
  requestsPerMinute: Number(row.requests_per_minute || 0),
  dailyCredits: Number(row.daily_credits || 0),
  documentLimitDaily: Number(row.document_limit_daily || 0),
  permissions: parseJsonArray(row.permissions),
  createdAt: toIso(row.created_at),
});

const mapClient = (row) => ({
  id: row.id,
  name: row.client_name,
  apiKeyHash: row.api_key_hash,
  apiKeyPreview: row.api_key_preview,
  planId: row.plan_id,
  active: row.active !== false,
  dailyCredits: Number(row.daily_credits || 0),
  remainingCredits: Number(row.remaining_credits || 0),
  lastRecharge: dateOnly(row.last_recharge),
  permissions: parseJsonArray(row.permissions),
  createdAt: toIso(row.created_at),
  revokedAt: toIso(row.revoked_at),
});

const mapSubscription = (row) => ({
  id: row.id,
  apiKeyId: row.api_key_id,
  planId: row.plan_id,
  status: row.status,
  startsAt: toIso(row.starts_at),
  endsAt: toIso(row.ends_at),
  billingReference: row.billing_reference,
});

const mapUsage = (row) => ({
  id: row.id,
  ts: toIso(row.created_at),
  event: row.event,
  clientId: row.api_key_id,
  clientName: row.client_name,
  endpoint: row.endpoint,
  method: row.method,
  ip: row.ip_address,
  status: row.status_code,
  responseTimeMs: row.response_time_ms,
  request: row.request_summary,
});

export const createApiStore = ({
  databaseUrl,
  clientsPath,
  usageLogPath,
  defaultStore,
  defaultPlans,
}) => {
  const pool = databaseUrl
    ? new Pool({
      connectionString: databaseUrl,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    })
    : null;

  const loadJsonStore = () => {
    if (!existsSync(clientsPath)) {
      mkdirSync(dirname(clientsPath), { recursive: true });
      writeFileSync(clientsPath, JSON.stringify(defaultStore(), null, 2));
    }

    const data = JSON.parse(readFileSync(clientsPath, 'utf8'));
    if (!Array.isArray(data.clients)) data.clients = [];
    if (!Array.isArray(data.plans)) data.plans = defaultPlans;
    if (!Array.isArray(data.subscriptions)) data.subscriptions = [];
    return data;
  };

  const saveJsonStore = (data) => {
    mkdirSync(dirname(clientsPath), { recursive: true });
    writeFileSync(clientsPath, JSON.stringify(data, null, 2));
  };

  const appendJsonUsage = (entry) => {
    mkdirSync(dirname(usageLogPath), { recursive: true });
    writeFileSync(usageLogPath, `${JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
    })}\n`, { flag: 'a' });
  };

  const readJsonUsage = (limit = 100) => {
    if (!existsSync(usageLogPath)) return [];
    return readFileSync(usageLogPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });
  };

  const upsertPlan = async (client, plan) => {
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
  };

  const upsertClient = async (db, client) => {
    const apiKeyHash = client.apiKeyHash || (client.apiKey ? createHash('sha256').update(String(client.apiKey)).digest('hex') : null);
    const apiKeyPreview = client.apiKeyPreview || (client.apiKey ? `${String(client.apiKey).slice(0, 12)}...${String(client.apiKey).slice(-4)}` : 'hash-only');
    if (!apiKeyHash) throw new Error(`Cliente API sin hash: ${client.id || client.name}`);

    await db.query(`
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
      client.id,
      client.name,
      apiKeyHash,
      apiKeyPreview,
      client.planId || 'basic',
      client.active !== false,
      Number(client.dailyCredits || 0),
      Number(client.remainingCredits || 0),
      client.lastRecharge,
      JSON.stringify(client.permissions || []),
      client.createdAt || null,
      client.revokedAt || null,
    ]);
  };

  const loadPostgresStore = async () => {
    const [plansResult, clientsResult, subscriptionsResult] = await Promise.all([
      pool.query('SELECT * FROM api_plans ORDER BY id'),
      pool.query('SELECT * FROM api_keys ORDER BY created_at DESC'),
      pool.query('SELECT * FROM api_subscriptions ORDER BY starts_at DESC'),
    ]);

    return {
      plans: plansResult.rows.map(mapPlan),
      clients: clientsResult.rows.map(mapClient),
      subscriptions: subscriptionsResult.rows.map(mapSubscription),
    };
  };

  const savePostgresStore = async (data) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const plan of data.plans || []) await upsertPlan(client, plan);
      for (const apiClient of data.clients || []) await upsertClient(client, apiClient);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  const appendPostgresUsage = async (entry) => {
    await pool.query(`
      INSERT INTO api_usage_logs (
        api_key_id, client_name, event, endpoint, method, ip_address,
        status_code, response_time_ms, request_summary
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
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
    ]);
  };

  const readPostgresUsage = async (limit = 100) => {
    const result = await pool.query(
      'SELECT * FROM api_usage_logs ORDER BY created_at DESC, id DESC LIMIT $1',
      [Number(limit)],
    );
    return result.rows.reverse().map(mapUsage);
  };

  const checkPostgresRateLimit = async (apiKeyId, limit) => {
    const windowStart = new Date(Math.floor(Date.now() / 60000) * 60000);
    const id = `${apiKeyId}:${windowStart.toISOString()}`;
    const result = await pool.query(`
      INSERT INTO api_rate_limits (id, api_key_id, window_start, request_count)
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (id) DO UPDATE SET request_count = api_rate_limits.request_count + 1
      RETURNING request_count
    `, [id, apiKeyId, windowStart]);
    return Number(result.rows[0]?.request_count || 0) <= Number(limit || 60);
  };

  const initialize = async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const plan of defaultPlans) await upsertPlan(client, plan);
      const seed = defaultStore();
      for (const apiClient of seed.clients || []) await upsertClient(client, apiClient);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    type: pool ? 'postgres' : 'json',
    pool,
    initialize,
    loadStore: () => (pool ? loadPostgresStore() : loadJsonStore()),
    saveStore: (data) => (pool ? savePostgresStore(data) : saveJsonStore(data)),
    appendUsage: (entry) => (pool ? appendPostgresUsage(entry) : appendJsonUsage(entry)),
    readUsage: (limit) => (pool ? readPostgresUsage(limit) : readJsonUsage(limit)),
    checkRateLimit: (apiKeyId, limit) => (pool ? checkPostgresRateLimit(apiKeyId, limit) : null),
  };
};
