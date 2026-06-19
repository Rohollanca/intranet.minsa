import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const distDir = join(__dirname, 'dist');
const port = Number(process.env.PORT || 10000);
const medicalApiBaseUrl = (process.env.MEDICAL_API_BASE_URL || 'https://intranet-api.alisadata.lat').replace(/\/$/, '');
const botFilesBaseUrl = (process.env.BOT_FILES_BASE_URL || 'https://intranet-files.alisadata.lat').replace(/\/$/, '');
const apiClientsPath = process.env.API_CLIENTS_PATH || join(__dirname, 'data', 'api-clients.json');
const apiUsageLogPath = process.env.API_USAGE_LOG_PATH || join(__dirname, 'data', 'api-usage.log');
const defaultApiKey = process.env.API_DEFAULT_KEY || 'sk_live_minsa_Q7v4N9p2K8r6T3x5H1m0D9s4';
const defaultDailyCredits = Number(process.env.API_DAILY_CREDITS || 50);
const apiRateLimitPerMinute = Number(process.env.API_RATE_LIMIT_PER_MINUTE || 60);
const adminToken = process.env.API_ADMIN_TOKEN || '';
const rateLimitBuckets = new Map();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const getToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const readRequestBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return resolve({});
    try {
      return resolve(JSON.parse(raw));
    } catch (error) {
      return reject(error);
    }
  });
  req.on('error', reject);
});

const loadApiClients = () => {
  if (!existsSync(apiClientsPath)) {
    mkdirSync(dirname(apiClientsPath), { recursive: true });
    const today = getToday();
    writeFileSync(apiClientsPath, JSON.stringify({
      clients: [
        {
          name: 'medico-demo',
          apiKey: defaultApiKey,
          dailyCredits: defaultDailyCredits,
          remainingCredits: defaultDailyCredits,
          lastRecharge: today,
          active: true,
        },
      ],
    }, null, 2));
  }
  return JSON.parse(readFileSync(apiClientsPath, 'utf8'));
};

const saveApiClients = (data) => {
  mkdirSync(dirname(apiClientsPath), { recursive: true });
  writeFileSync(apiClientsPath, JSON.stringify(data, null, 2));
};

const getApiKey = (req) => {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(req.headers['x-api-key'] || '').trim();
};

const getClientForRequest = (req) => {
  const apiKey = getApiKey(req);
  if (!apiKey) return { error: 'API key requerida' };

  const data = loadApiClients();
  const client = data.clients.find((item) => item.apiKey === apiKey);
  if (!client || client.active === false) return { error: 'API key no autorizada' };

  const today = getToday();
  if (client.lastRecharge !== today) {
    client.remainingCredits = Number(client.dailyCredits || defaultDailyCredits);
    client.lastRecharge = today;
    saveApiClients(data);
  }

  return { data, client };
};

const consumeCredit = (data, client, amount = 1) => {
  if (Number(client.remainingCredits || 0) < amount) {
    return false;
  }
  client.remainingCredits = Number(client.remainingCredits || 0) - amount;
  saveApiClients(data);
  return true;
};

const handleApiV1 = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const auth = getClientForRequest(req);
  if (auth.error) {
    return sendJson(res, 401, { ok: false, error: auth.error });
  }

  const { data, client } = auth;

  if (req.method === 'GET' && url.pathname === '/api/v1/saldo') {
    return sendJson(res, 200, {
      ok: true,
      cliente: client.name,
      creditos_diarios: Number(client.dailyCredits || defaultDailyCredits),
      creditos_restantes: Number(client.remainingCredits || 0),
      ultima_recarga: client.lastRecharge,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/consulta-demo') {
    let body = {};
    try {
      body = await readRequestBody(req);
    } catch {
      return sendJson(res, 400, { ok: false, error: 'JSON inválido' });
    }

    if (!consumeCredit(data, client, 1)) {
      return sendJson(res, 402, {
        ok: false,
        error: 'Sin créditos disponibles',
        creditos_restantes: Number(client.remainingCredits || 0),
      });
    }

    return sendJson(res, 200, {
      ok: true,
      tipo: 'consulta_demo',
      mensaje: 'Crédito descontado correctamente. Endpoint demo para integración autorizada.',
      entrada: body,
      creditos_restantes: Number(client.remainingCredits || 0),
    });
  }

  return sendJson(res, 404, {
    ok: false,
    error: 'Endpoint API no encontrado',
    endpoints: ['GET /api/v1/saldo', 'POST /api/v1/consulta-demo'],
  });
};

const proxyRequest = (req, res, targetBaseUrl, stripPrefix) => {
  const target = new URL(req.url.replace(stripPrefix, '') || '/', targetBaseUrl);
  const client = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const headers = { ...req.headers, host: target.host };
  delete headers['content-length'];

  const upstream = client(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers,
      timeout: 70000,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on('timeout', () => upstream.destroy(new Error('Tiempo de espera agotado')));
  upstream.on('error', (error) => {
    sendJson(res, 502, {
      success: false,
      error: 'No se pudo conectar con el servicio interno.',
      detail: error.message,
    });
  });

  req.pipe(upstream);
};

const serveStatic = async (req, res) => {
  const requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(distDir, safePath === '/' ? 'index.html' : safePath);

  if (!existsSync(filePath)) {
    filePath = join(distDir, 'index.html');
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('No es archivo');
    res.writeHead(200, {
      'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(filePath).pipe(res);
  } catch {
    sendJson(res, 404, { error: 'Archivo no encontrado' });
  }
};

const apiCreateKey = () => `sk_live_${randomBytes(24).toString('base64url')}`;
const apiCreateClientId = () => `cli_${randomBytes(8).toString('hex')}`;

const apiSaveStore = (data) => {
  mkdirSync(dirname(apiClientsPath), { recursive: true });
  writeFileSync(apiClientsPath, JSON.stringify(data, null, 2));
};

const apiLoadStore = () => {
  if (!existsSync(apiClientsPath)) {
    const today = getToday();
    apiSaveStore({
      clients: [
        {
          id: 'cli_demo',
          name: 'medico-demo',
          apiKey: defaultApiKey,
          dailyCredits: defaultDailyCredits,
          remainingCredits: defaultDailyCredits,
          lastRecharge: today,
          active: true,
          createdAt: new Date().toISOString(),
        },
      ],
    });
  }

  const data = JSON.parse(readFileSync(apiClientsPath, 'utf8'));
  if (!Array.isArray(data.clients)) data.clients = [];

  let changed = false;
  for (const client of data.clients) {
    if (!client.id) {
      client.id = apiCreateClientId();
      changed = true;
    }
    if (!client.createdAt) {
      client.createdAt = new Date().toISOString();
      changed = true;
    }
    if (client.active === undefined) {
      client.active = true;
      changed = true;
    }
    if (!client.dailyCredits) {
      client.dailyCredits = defaultDailyCredits;
      changed = true;
    }
    if (client.remainingCredits === undefined) {
      client.remainingCredits = Number(client.dailyCredits || defaultDailyCredits);
      changed = true;
    }
    if (client.name === 'medico-demo' && client.apiKey === 'sk_medico_090558') {
      client.apiKey = defaultApiKey;
      changed = true;
    }
  }

  if (changed) apiSaveStore(data);
  return data;
};

const apiGetIp = (req) => String(
  req.headers['cf-connecting-ip']
  || req.headers['x-forwarded-for']
  || req.socket.remoteAddress
  || '',
).split(',')[0].trim();

const apiAppendUsage = (entry) => {
  mkdirSync(dirname(apiUsageLogPath), { recursive: true });
  writeFileSync(apiUsageLogPath, `${JSON.stringify({
    ts: new Date().toISOString(),
    ...entry,
  })}\n`, { flag: 'a' });
};

const apiReadUsage = (limit = 100) => {
  if (!existsSync(apiUsageLogPath)) return [];
  return readFileSync(apiUsageLogPath, 'utf8')
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

const apiRechargeClient = (data, client) => {
  const today = getToday();
  if (client.lastRecharge !== today) {
    client.remainingCredits = Number(client.dailyCredits || defaultDailyCredits);
    client.lastRecharge = today;
    apiSaveStore(data);
  }
};

const apiCheckRateLimit = (client) => {
  const minute = Math.floor(Date.now() / 60000);
  const key = `${client.id}:${minute}`;
  const used = Number(rateLimitBuckets.get(key) || 0) + 1;
  rateLimitBuckets.set(key, used);

  if (rateLimitBuckets.size > 2000) {
    for (const bucket of rateLimitBuckets.keys()) {
      if (!bucket.endsWith(`:${minute}`)) rateLimitBuckets.delete(bucket);
    }
  }

  return used <= apiRateLimitPerMinute;
};

const apiAuthorizeClient = (req) => {
  const apiKey = getApiKey(req);
  if (!apiKey) return { error: 'API key requerida', statusCode: 401 };

  const data = apiLoadStore();
  const client = data.clients.find((item) => item.apiKey === apiKey);
  if (!client || client.active === false) return { error: 'API key no autorizada', statusCode: 401 };

  apiRechargeClient(data, client);

  if (!apiCheckRateLimit(client)) {
    return { error: 'Demasiadas solicitudes por minuto', statusCode: 429 };
  }

  return { data, client };
};

const apiRequireAdmin = (req, res) => {
  if (!adminToken) {
    sendJson(res, 503, {
      ok: false,
      error: 'API_ADMIN_TOKEN no configurado en Render',
    });
    return false;
  }

  const token = getApiKey(req) || String(req.headers['x-admin-token'] || '').trim();
  if (token !== adminToken) {
    sendJson(res, 401, { ok: false, error: 'Token admin no autorizado' });
    return false;
  }

  return true;
};

const apiPublicClient = (client, includeKey = false) => ({
  id: client.id,
  name: client.name,
  active: client.active !== false,
  dailyCredits: Number(client.dailyCredits || defaultDailyCredits),
  remainingCredits: Number(client.remainingCredits || 0),
  lastRecharge: client.lastRecharge,
  createdAt: client.createdAt,
  ...(includeKey ? { apiKey: client.apiKey } : {}),
});

const handleApiV1Real = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/v1/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'intranet-api-clientes',
      date: getToday(),
    });
  }

  if (url.pathname.startsWith('/api/v1/admin/')) {
    if (!apiRequireAdmin(req, res)) return;
    const data = apiLoadStore();

    if (req.method === 'GET' && url.pathname === '/api/v1/admin/clientes') {
      for (const client of data.clients) apiRechargeClient(data, client);
      return sendJson(res, 200, {
        ok: true,
        clientes: data.clients.map((client) => apiPublicClient(client)),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/admin/clientes') {
      let body = {};
      try {
        body = await readRequestBody(req);
      } catch {
        return sendJson(res, 400, { ok: false, error: 'JSON invalido' });
      }

      const dailyCredits = Math.max(0, Number(body.dailyCredits || defaultDailyCredits));
      const client = {
        id: apiCreateClientId(),
        name: String(body.name || `cliente-${data.clients.length + 1}`).trim(),
        apiKey: apiCreateKey(),
        dailyCredits,
        remainingCredits: dailyCredits,
        lastRecharge: getToday(),
        active: true,
        createdAt: new Date().toISOString(),
      };

      data.clients.push(client);
      apiSaveStore(data);
      apiAppendUsage({
        event: 'admin_create_client',
        clientId: client.id,
        clientName: client.name,
        ip: apiGetIp(req),
      });

      return sendJson(res, 201, {
        ok: true,
        cliente: apiPublicClient(client, true),
      });
    }

    const clientMatch = url.pathname.match(/^\/api\/v1\/admin\/clientes\/([^/]+)$/);
    if (clientMatch && req.method === 'PATCH') {
      const client = data.clients.find((item) => item.id === clientMatch[1]);
      if (!client) return sendJson(res, 404, { ok: false, error: 'Cliente no encontrado' });

      let body = {};
      try {
        body = await readRequestBody(req);
      } catch {
        return sendJson(res, 400, { ok: false, error: 'JSON invalido' });
      }

      if (body.name !== undefined) client.name = String(body.name).trim();
      if (body.active !== undefined) client.active = Boolean(body.active);
      if (body.dailyCredits !== undefined) client.dailyCredits = Math.max(0, Number(body.dailyCredits));
      if (body.remainingCredits !== undefined) client.remainingCredits = Math.max(0, Number(body.remainingCredits));
      apiSaveStore(data);
      apiAppendUsage({
        event: 'admin_update_client',
        clientId: client.id,
        clientName: client.name,
        ip: apiGetIp(req),
      });

      return sendJson(res, 200, {
        ok: true,
        cliente: apiPublicClient(client),
      });
    }

    const rechargeMatch = url.pathname.match(/^\/api\/v1\/admin\/clientes\/([^/]+)\/recargar$/);
    if (rechargeMatch && req.method === 'POST') {
      const client = data.clients.find((item) => item.id === rechargeMatch[1]);
      if (!client) return sendJson(res, 404, { ok: false, error: 'Cliente no encontrado' });

      let body = {};
      try {
        body = await readRequestBody(req);
      } catch {
        return sendJson(res, 400, { ok: false, error: 'JSON invalido' });
      }

      const amount = body.amount === undefined ? Number(client.dailyCredits || defaultDailyCredits) : Number(body.amount);
      const mode = body.mode === 'add' ? 'add' : 'set';
      client.remainingCredits = mode === 'add'
        ? Math.max(0, Number(client.remainingCredits || 0) + amount)
        : Math.max(0, amount);
      client.lastRecharge = getToday();
      apiSaveStore(data);
      apiAppendUsage({
        event: 'admin_recharge_client',
        clientId: client.id,
        clientName: client.name,
        amount,
        mode,
        ip: apiGetIp(req),
      });

      return sendJson(res, 200, {
        ok: true,
        cliente: apiPublicClient(client),
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/admin/uso') {
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 100)));
      return sendJson(res, 200, {
        ok: true,
        eventos: apiReadUsage(limit),
      });
    }

    return sendJson(res, 404, { ok: false, error: 'Endpoint admin no encontrado' });
  }

  const auth = apiAuthorizeClient(req);
  if (auth.error) {
    return sendJson(res, auth.statusCode || 401, { ok: false, error: auth.error });
  }

  const { data, client } = auth;

  if (req.method === 'GET' && url.pathname === '/api/v1/saldo') {
    return sendJson(res, 200, {
      ok: true,
      cliente_id: client.id,
      cliente: client.name,
      creditos_diarios: Number(client.dailyCredits || defaultDailyCredits),
      creditos_restantes: Number(client.remainingCredits || 0),
      ultima_recarga: client.lastRecharge,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/consulta-demo') {
    let body = {};
    try {
      body = await readRequestBody(req);
    } catch {
      return sendJson(res, 400, { ok: false, error: 'JSON invalido' });
    }

    if (!consumeCredit(data, client, 1)) {
      apiAppendUsage({
        event: 'credit_denied',
        clientId: client.id,
        clientName: client.name,
        endpoint: url.pathname,
        ip: apiGetIp(req),
      });
      return sendJson(res, 402, {
        ok: false,
        error: 'Sin creditos disponibles',
        creditos_restantes: Number(client.remainingCredits || 0),
      });
    }

    apiAppendUsage({
      event: 'credit_consumed',
      clientId: client.id,
      clientName: client.name,
      endpoint: url.pathname,
      ip: apiGetIp(req),
      request: body,
      remainingCredits: Number(client.remainingCredits || 0),
    });

    return sendJson(res, 200, {
      ok: true,
      tipo: 'consulta_demo',
      mensaje: 'Credito descontado correctamente. Endpoint demo para integracion autorizada.',
      entrada: body,
      creditos_restantes: Number(client.remainingCredits || 0),
    });
  }

  return sendJson(res, 404, {
    ok: false,
    error: 'Endpoint API no encontrado',
    endpoints: [
      'GET /api/v1/health',
      'GET /api/v1/saldo',
      'POST /api/v1/consulta-demo',
      'GET /api/v1/admin/clientes',
      'POST /api/v1/admin/clientes',
      'PATCH /api/v1/admin/clientes/:id',
      'POST /api/v1/admin/clientes/:id/recargar',
      'GET /api/v1/admin/uso',
    ],
  });
};

const server = createServer((req, res) => {
  if (req.url === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'sistema-medico-web',
      medicalApiBaseUrl,
      botFilesBaseUrl,
    });
  }

  if (req.url.startsWith('/api/v1/')) {
    return handleApiV1Real(req, res);
  }

  if (req.url.startsWith('/bot-api')) {
    return proxyRequest(req, res, medicalApiBaseUrl, /^\/bot-api/);
  }

  if (req.url.startsWith('/bot-files')) {
    return proxyRequest(req, res, botFilesBaseUrl, /^\/bot-files/);
  }

  return serveStatic(req, res);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Sistema medico corriendo en http://0.0.0.0:${port}`);
});
