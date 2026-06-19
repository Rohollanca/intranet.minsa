import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOfficialDocument } from './src/lib/documentService.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const distDir = join(__dirname, 'dist');
const port = Number(process.env.PORT || 10000);
const medicalApiBaseUrl = (process.env.MEDICAL_API_BASE_URL || 'https://intranet-api.alisadata.lat').replace(/\/$/, '');
const botFilesBaseUrl = (process.env.BOT_FILES_BASE_URL || 'https://intranet-files.alisadata.lat').replace(/\/$/, '');
const verificationBaseUrl = (process.env.VITE_VERIFICATION_BASE_URL || 'https://portalwebminsa-certificados.onrender.com').replace(/\/$/, '');
const apiClientsPath = process.env.API_CLIENTS_PATH || join(__dirname, 'data', 'api-clients.json');
const apiUsageLogPath = process.env.API_USAGE_LOG_PATH || join(__dirname, 'data', 'api-usage.log');
const defaultApiKey = process.env.API_DEFAULT_KEY || 'sk_live_minsa_Q7v4N9p2K8r6T3x5H1m0D9s4';
const defaultDailyCredits = Number(process.env.API_DAILY_CREDITS || 50);
const apiRateLimitPerMinute = Number(process.env.API_RATE_LIMIT_PER_MINUTE || 60);
const adminToken = process.env.API_ADMIN_TOKEN || '';
const rateLimitBuckets = new Map();
const apiDocumentsEnabled = process.env.API_ENABLE_DOCUMENT_GENERATION === 'true';

const defaultApiPlans = [
  { id: 'free', name: 'Plan gratuito', requestsPerMinute: 20, dailyCredits: 10, documentLimitDaily: 0, permissions: ['saldo', 'consulta_demo'] },
  { id: 'basic', name: 'Plan basico', requestsPerMinute: 60, dailyCredits: 50, documentLimitDaily: 25, permissions: ['saldo', 'consulta_demo', 'pacientes', 'consultas'] },
  { id: 'professional', name: 'Plan profesional', requestsPerMinute: 120, dailyCredits: 250, documentLimitDaily: 100, permissions: ['saldo', 'consulta_demo', 'pacientes', 'consultas', 'documentos'] },
  { id: 'enterprise', name: 'Plan empresarial', requestsPerMinute: 300, dailyCredits: 1000, documentLimitDaily: 500, permissions: ['saldo', 'consulta_demo', 'pacientes', 'consultas', 'documentos', 'admin_integracion'] },
];

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
const apiHashKey = (apiKey) => createHash('sha256').update(String(apiKey)).digest('hex');
const apiKeyPreview = (apiKey) => `${String(apiKey).slice(0, 12)}...${String(apiKey).slice(-4)}`;

const apiSafeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''), 'hex');
  const rightBuffer = Buffer.from(String(right || ''), 'hex');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
};

const apiDefaultStore = () => ({
  plans: defaultApiPlans,
  subscriptions: [],
  clients: [
    {
      id: 'cli_demo',
      name: 'medico-demo',
      apiKey: defaultApiKey,
      apiKeyPreview: apiKeyPreview(defaultApiKey),
      planId: 'basic',
      dailyCredits: defaultDailyCredits,
      remainingCredits: defaultDailyCredits,
      lastRecharge: getToday(),
      active: true,
      permissions: ['saldo', 'consulta_demo', 'pacientes', 'consultas'],
      createdAt: new Date().toISOString(),
    },
  ],
});

const apiSaveStore = (data) => {
  mkdirSync(dirname(apiClientsPath), { recursive: true });
  writeFileSync(apiClientsPath, JSON.stringify(data, null, 2));
};

const apiLoadStore = () => {
  if (!existsSync(apiClientsPath)) {
    apiSaveStore(apiDefaultStore());
  }

  const data = JSON.parse(readFileSync(apiClientsPath, 'utf8'));
  if (!Array.isArray(data.clients)) data.clients = [];
  if (!Array.isArray(data.plans)) data.plans = defaultApiPlans;
  if (!Array.isArray(data.subscriptions)) data.subscriptions = [];

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
    if (!client.apiKeyHash && client.apiKey) {
      client.apiKeyHash = apiHashKey(client.apiKey);
      client.apiKeyPreview = apiKeyPreview(client.apiKey);
      if (client.name !== 'medico-demo') delete client.apiKey;
      changed = true;
    }
    if (!client.planId) {
      client.planId = 'basic';
      changed = true;
    }
    if (!Array.isArray(client.permissions)) {
      const plan = data.plans.find((item) => item.id === client.planId) || data.plans[0];
      client.permissions = plan?.permissions || ['saldo'];
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

const apiGetPlan = (data, client) => data.plans.find((plan) => plan.id === client.planId) || data.plans.find((plan) => plan.id === 'basic') || defaultApiPlans[1];

const apiHasPermission = (data, client, permission) => {
  const plan = apiGetPlan(data, client);
  const permissions = new Set([...(plan?.permissions || []), ...(client.permissions || [])]);
  return permissions.has(permission);
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

  return used <= Number(client.requestsPerMinute || apiRateLimitPerMinute);
};

const apiAuthorizeClient = (req) => {
  const apiKey = getApiKey(req);
  if (!apiKey) return { error: 'API key requerida', statusCode: 401 };

  const data = apiLoadStore();
  const apiKeyHash = apiHashKey(apiKey);
  const client = data.clients.find((item) => (
    (item.apiKeyHash && apiSafeEqual(item.apiKeyHash, apiKeyHash))
    || (item.apiKey && item.apiKey === apiKey)
  ));
  if (!client || client.active === false) return { error: 'API key no autorizada', statusCode: 401 };

  apiRechargeClient(data, client);

  const plan = apiGetPlan(data, client);
  client.requestsPerMinute = Number(client.requestsPerMinute || plan?.requestsPerMinute || apiRateLimitPerMinute);

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
  planId: client.planId || 'basic',
  permissions: client.permissions || [],
  dailyCredits: Number(client.dailyCredits || defaultDailyCredits),
  remainingCredits: Number(client.remainingCredits || 0),
  lastRecharge: client.lastRecharge,
  createdAt: client.createdAt,
  apiKeyPreview: client.apiKeyPreview || (client.apiKey ? apiKeyPreview(client.apiKey) : undefined),
  ...(includeKey ? { apiKey: client.apiKey } : {}),
});

const apiOk = (data = {}, meta = {}) => ({ ok: true, data, meta });
const apiFail = (code, message, details = undefined) => ({
  ok: false,
  error: { code, message, ...(details ? { details } : {}) },
});

const apiConsumeCredit = (data, client, amount = 1) => {
  if (Number(client.remainingCredits || 0) < amount) return false;
  client.remainingCredits = Number(client.remainingCredits || 0) - amount;
  apiSaveStore(data);
  return true;
};

const apiOpenApiDocument = () => ({
  openapi: '3.0.3',
  info: {
    title: 'Intranet General del MINSA - API comercial',
    version: '1.0.0',
    description: 'API REST para integraciones autorizadas con control por API key, planes, creditos, logs y metricas.',
  },
  servers: [{ url: 'https://intranet-portalwebminsa.onrender.com' }],
  components: {
    securitySchemes: {
      ApiKeyBearer: { type: 'http', scheme: 'bearer' },
    },
  },
  security: [{ ApiKeyBearer: [] }],
  paths: {
    '/api/v1/health': { get: { summary: 'Estado del servicio' } },
    '/api/v1/saldo': { get: { summary: 'Consultar saldo de creditos' } },
    '/api/v1/pacientes': { post: { summary: 'Consultar o registrar datos de paciente autorizado' } },
    '/api/v1/consultas': { post: { summary: 'Registrar una consulta autorizada' } },
    '/api/v1/descansos': { post: { summary: 'Preparar solicitud de descanso medico autorizada' } },
    '/api/v1/certificados': { post: { summary: 'Preparar solicitud de certificado medico autorizada' } },
    '/api/v1/recetas': { post: { summary: 'Preparar solicitud de receta medica autorizada' } },
    '/api/v1/documentos/generar': { post: { summary: 'Generar documento en entorno autorizado si esta habilitado' } },
    '/api/v1/admin/clientes': { get: { summary: 'Listar clientes' }, post: { summary: 'Crear cliente y API key' } },
    '/api/v1/admin/planes': { get: { summary: 'Listar planes comerciales' } },
    '/api/v1/admin/metricas': { get: { summary: 'Metricas de uso' } },
    '/api/v1/admin/uso': { get: { summary: 'Logs de auditoria' } },
  },
});

const apiValidateRequired = (body, fields) => {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  return missing.length ? missing : null;
};

const arrayBufferFromBuffer = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

const apiLoadTemplateFromPublic = async (path) => {
  const safePath = normalize(String(path || '').replace(/^[/\\]+/, ''));
  const fullPath = join(__dirname, 'public', safePath);
  if (!existsSync(fullPath)) return null;
  const buffer = readFileSync(fullPath);
  return { path, buffer: arrayBufferFromBuffer(buffer) };
};

const apiDocumentLabels = {
  descanso: 'Descanso Médico',
  certificado: 'Certificado Médico',
  receta: 'Receta Médica',
};

const apiBuildDocumentInput = (body, documentIdFromRoute) => {
  const documentId = documentIdFromRoute === 'documento'
    ? String(body.documento || body.documentoId || '').toLowerCase()
    : documentIdFromRoute;

  const patient = body.patient || body.paciente || {};
  const receivedForm = body.formData || body.form_data || body.datos || {};
  const institucion = String(body.institucion || receivedForm.institucion || 'MINSA').toUpperCase() === 'ESSALUD' ? 'ESSALUD' : 'MINSA';

  const formData = {
    establecimiento: receivedForm.establecimiento || body.establecimiento || '',
    servicio: receivedForm.servicio || body.servicio || 'EMERGENCIA',
    profesional: receivedForm.profesional || body.profesional || 'RUZ VIVAS, NILIBETH LORIANNY',
    cmp: receivedForm.cmp || body.cmp || '090558',
    cie: receivedForm.cie || body.cie || body.cie10 || null,
    dias: receivedForm.dias || body.dias || 3,
    fechaInicio: receivedForm.fechaInicio || receivedForm.fecha_inicio || body.fechaInicio || body.fecha_inicio || new Date().toISOString().split('T')[0],
    horaIngreso: receivedForm.horaIngreso || receivedForm.hora_ingreso || body.horaIngreso || body.hora_ingreso || '08:00',
    obsCustom: receivedForm.obsCustom || receivedForm.observaciones || body.observaciones || '',
    usarObsAuto: receivedForm.usarObsAuto ?? body.usarObsAuto ?? true,
    farmacia: receivedForm.farmacia || body.farmacia || 'FARMACIA CENTRAL',
    pi: receivedForm.pi || body.pi || patient.pi || '',
    distrito: receivedForm.distrito || body.distrito || 'LIMA',
    tipoAtencion: receivedForm.tipoAtencion || receivedForm.tipo_atencion || body.tipoAtencion || body.tipo_atencion || 'EMERGENCIA/URGENCIAS',
    diasNoConsecutivos: receivedForm.diasNoConsecutivos || receivedForm.dias_no_consecutivos || body.diasNoConsecutivos || '0',
    vigencia: receivedForm.vigencia || body.vigencia || new Date().toISOString().split('T')[0],
    numeroOrden: receivedForm.numeroOrden || receivedForm.numero_orden || body.numeroOrden || body.numero_orden || '',
    meds: receivedForm.meds || receivedForm.medicamentos || body.meds || body.medicamentos || [],
  };

  if (!Array.isArray(formData.meds) || !formData.meds.length) {
    formData.meds = [{ nombre: '', concentracion: '', presentacion: '', cantidad: '', unidad: 'MG', via: 'ORAL', frecuencia: '', duracion: '', indicacion: '' }];
  }

  return {
    patient,
    formData,
    selectedDoc: { id: documentId, label: apiDocumentLabels[documentId] || 'Documento de salud' },
    institucion,
  };
};

const apiConvertDocxToPdf = async (docxBuffer) => {
  const form = new FormData();
  const blob = new Blob([docxBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  form.append('file', blob, 'document.docx');

  const response = await fetch(`${medicalApiBaseUrl}/convert-docx-to-pdf`, {
    method: 'POST',
    body: form,
  });
  const result = await response.json();
  if (!response.ok || result.status !== 'success') {
    throw new Error(result.detail || result.error || 'Fallo en la conversion nativa');
  }
  return result.pdf_base64;
};

const handleApiV1Real = async (req, res) => {
  const startedAt = Date.now();
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/v1/openapi.json') {
    return sendJson(res, 200, apiOpenApiDocument());
  }

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

    if (req.method === 'GET' && url.pathname === '/api/v1/admin/planes') {
      return sendJson(res, 200, apiOk({
        planes: data.plans,
      }));
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/admin/metricas') {
      const eventos = apiReadUsage(1000);
      const porEndpoint = {};
      const porCliente = {};
      for (const item of eventos) {
        const endpoint = item.endpoint || item.event || 'desconocido';
        porEndpoint[endpoint] = (porEndpoint[endpoint] || 0) + 1;
        if (item.clientId) porCliente[item.clientId] = (porCliente[item.clientId] || 0) + 1;
      }
      return sendJson(res, 200, apiOk({
        total_eventos: eventos.length,
        por_endpoint: porEndpoint,
        por_cliente: porCliente,
        clientes_activos: data.clients.filter((item) => item.active !== false).length,
      }));
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/admin/clientes') {
      let body = {};
      try {
        body = await readRequestBody(req);
      } catch {
        return sendJson(res, 400, { ok: false, error: 'JSON invalido' });
      }

      const plan = data.plans.find((item) => item.id === body.planId) || data.plans.find((item) => item.id === 'basic') || defaultApiPlans[1];
      const apiKey = apiCreateKey();
      const dailyCredits = Math.max(0, Number(body.dailyCredits || plan.dailyCredits || defaultDailyCredits));
      const client = {
        id: apiCreateClientId(),
        name: String(body.name || `cliente-${data.clients.length + 1}`).trim(),
        apiKeyHash: apiHashKey(apiKey),
        apiKeyPreview: apiKeyPreview(apiKey),
        planId: plan.id,
        dailyCredits,
        remainingCredits: dailyCredits,
        lastRecharge: getToday(),
        active: true,
        permissions: Array.isArray(body.permissions) ? body.permissions : plan.permissions,
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
        cliente: {
          ...apiPublicClient(client),
          apiKey,
        },
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
      if (body.planId !== undefined && data.plans.some((plan) => plan.id === body.planId)) client.planId = body.planId;
      if (Array.isArray(body.permissions)) client.permissions = body.permissions;
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
    apiAppendUsage({
      event: 'request',
      clientId: client.id,
      clientName: client.name,
      endpoint: url.pathname,
      method: req.method,
      ip: apiGetIp(req),
      status: 200,
      responseTimeMs: Date.now() - startedAt,
    });
    return sendJson(res, 200, {
      ok: true,
      cliente_id: client.id,
      cliente: client.name,
      creditos_diarios: Number(client.dailyCredits || defaultDailyCredits),
      creditos_restantes: Number(client.remainingCredits || 0),
      ultima_recarga: client.lastRecharge,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/pacientes') {
    if (!apiHasPermission(data, client, 'pacientes')) {
      return sendJson(res, 403, apiFail('PERMISSION_DENIED', 'El plan no permite consultar pacientes'));
    }

    let body = {};
    try {
      body = await readRequestBody(req);
    } catch {
      return sendJson(res, 400, apiFail('INVALID_JSON', 'JSON invalido'));
    }

    const missing = apiValidateRequired(body, ['dni']);
    if (missing) return sendJson(res, 422, apiFail('VALIDATION_ERROR', 'Faltan campos requeridos', { missing }));
    if (!/^\d{8}$/.test(String(body.dni))) return sendJson(res, 422, apiFail('VALIDATION_ERROR', 'El DNI debe tener 8 digitos'));

    if (!apiConsumeCredit(data, client, 1)) {
      return sendJson(res, 402, apiFail('NO_CREDITS', 'Sin creditos disponibles'));
    }

    const payload = {
      dni: String(body.dni),
      modo: body.modo || 'registro_autorizado',
      mensaje: 'Solicitud de paciente registrada para integracion autorizada.',
      creditos_restantes: Number(client.remainingCredits || 0),
    };

    apiAppendUsage({
      event: 'request',
      clientId: client.id,
      clientName: client.name,
      endpoint: url.pathname,
      method: req.method,
      ip: apiGetIp(req),
      status: 200,
      responseTimeMs: Date.now() - startedAt,
    });
    return sendJson(res, 200, apiOk(payload));
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/consultas') {
    if (!apiHasPermission(data, client, 'consultas')) {
      return sendJson(res, 403, apiFail('PERMISSION_DENIED', 'El plan no permite registrar consultas'));
    }

    let body = {};
    try {
      body = await readRequestBody(req);
    } catch {
      return sendJson(res, 400, apiFail('INVALID_JSON', 'JSON invalido'));
    }

    const missing = apiValidateRequired(body, ['dni', 'tipo']);
    if (missing) return sendJson(res, 422, apiFail('VALIDATION_ERROR', 'Faltan campos requeridos', { missing }));

    if (!apiConsumeCredit(data, client, 1)) {
      return sendJson(res, 402, apiFail('NO_CREDITS', 'Sin creditos disponibles'));
    }

    const consultaId = `con_${randomBytes(8).toString('hex')}`;
    apiAppendUsage({
      event: 'request',
      clientId: client.id,
      clientName: client.name,
      endpoint: url.pathname,
      method: req.method,
      ip: apiGetIp(req),
      status: 201,
      responseTimeMs: Date.now() - startedAt,
      request: { dni: body.dni, tipo: body.tipo },
    });

    return sendJson(res, 201, apiOk({
      consulta_id: consultaId,
      estado: 'registrada',
      creditos_restantes: Number(client.remainingCredits || 0),
    }));
  }

  const documentRoutes = {
    '/api/v1/descansos': 'descanso',
    '/api/v1/certificados': 'certificado',
    '/api/v1/recetas': 'receta',
    '/api/v1/documentos/generar': 'documento',
  };

  if (req.method === 'POST' && documentRoutes[url.pathname]) {
    if (!apiHasPermission(data, client, 'documentos')) {
      return sendJson(res, 403, apiFail('PERMISSION_DENIED', 'El plan no permite generacion de documentos'));
    }

    let body = {};
    try {
      body = await readRequestBody(req);
    } catch {
      return sendJson(res, 400, apiFail('INVALID_JSON', 'JSON invalido'));
    }

    const documentIdFromRoute = documentRoutes[url.pathname];
    if (url.pathname === '/api/v1/documentos/generar' && !body.documento && !body.documentoId) {
      return sendJson(res, 422, apiFail('VALIDATION_ERROR', 'Faltan campos requeridos', { missing: ['documento'] }));
    }

    const documentInput = apiBuildDocumentInput(body, documentIdFromRoute);
    if (!['descanso', 'certificado', 'receta'].includes(documentInput.selectedDoc.id)) {
      return sendJson(res, 422, apiFail('VALIDATION_ERROR', 'Documento no soportado', { allowed: ['descanso', 'certificado', 'receta'] }));
    }

    const missing = [];
    if (!documentInput.patient?.nombre) missing.push('paciente.nombre');
    if (!documentInput.patient?.dni) missing.push('paciente.dni');
    if (!documentInput.formData?.establecimiento) missing.push('formData.establecimiento');
    if (documentInput.selectedDoc.id !== 'receta' && !documentInput.formData?.cie) missing.push('formData.cie');
    if (missing.length) {
      return sendJson(res, 422, apiFail('VALIDATION_ERROR', 'Faltan campos requeridos', { missing }));
    }

    if (!apiDocumentsEnabled) {
      apiAppendUsage({
        event: 'document_generation_blocked',
        clientId: client.id,
        clientName: client.name,
        endpoint: url.pathname,
        method: req.method,
        ip: apiGetIp(req),
        status: 403,
        responseTimeMs: Date.now() - startedAt,
      });
      return sendJson(res, 403, apiFail(
        'DOCUMENT_GENERATION_DISABLED',
        'La generacion de documentos por API esta deshabilitada. Habilitala solo para integraciones internas autorizadas con API_ENABLE_DOCUMENT_GENERATION=true.',
      ));
    }

    if (Number(client.remainingCredits || 0) < 1) {
      return sendJson(res, 402, apiFail('NO_CREDITS', 'Sin creditos disponibles'));
    }

    let generated;
    let pdfBase64;
    try {
      generated = await createOfficialDocument({
        ...documentInput,
        verificationBaseUrl,
        loadTemplate: apiLoadTemplateFromPublic,
        output: 'nodebuffer',
      });
      pdfBase64 = await apiConvertDocxToPdf(generated.docx);
    } catch (error) {
      apiAppendUsage({
        event: 'document_generation_failed',
        clientId: client.id,
        clientName: client.name,
        endpoint: url.pathname,
        method: req.method,
        ip: apiGetIp(req),
        status: 500,
        responseTimeMs: Date.now() - startedAt,
      });
      return sendJson(res, 500, apiFail('DOCUMENT_GENERATION_FAILED', 'No se pudo generar el documento solicitado'));
    }

    apiConsumeCredit(data, client, 1);
    const documentId = `doc_${randomBytes(8).toString('hex')}`;
    apiAppendUsage({
      event: 'document_generation_requested',
      clientId: client.id,
      clientName: client.name,
      endpoint: url.pathname,
      method: req.method,
      ip: apiGetIp(req),
      status: 202,
      responseTimeMs: Date.now() - startedAt,
      request: { documento: documentInput.selectedDoc.id, dni: documentInput.patient?.dni },
    });

    return sendJson(res, 200, apiOk({
      documento_id: documentId,
      estado: 'generado',
      tipo: documentInput.selectedDoc.id,
      codigo_verificacion: generated.generated.codigoVerificacion,
      url_verificacion: generated.generated.verificationUrl,
      template: generated.templatePath,
      pdf_base64: pdfBase64,
      creditos_restantes: Number(client.remainingCredits || 0),
    }));
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
      'GET /api/v1/openapi.json',
      'GET /api/v1/saldo',
      'POST /api/v1/consulta-demo',
      'POST /api/v1/pacientes',
      'POST /api/v1/consultas',
      'POST /api/v1/descansos',
      'POST /api/v1/certificados',
      'POST /api/v1/recetas',
      'POST /api/v1/documentos/generar',
      'GET /api/v1/admin/clientes',
      'POST /api/v1/admin/clientes',
      'GET /api/v1/admin/planes',
      'GET /api/v1/admin/metricas',
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

  if (req.url === '/api/docs') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>API Docs</title><style>body{font-family:Arial,sans-serif;margin:40px;line-height:1.5;color:#1f2937}code,pre{background:#f3f4f6;padding:2px 6px;border-radius:4px}a{color:#005b96}</style></head><body><h1>Intranet General del MINSA - API REST</h1><p>Documentacion OpenAPI disponible en <a href="/api/v1/openapi.json">/api/v1/openapi.json</a>.</p><p>Autenticacion: <code>Authorization: Bearer API_KEY</code></p><pre>GET /api/v1/saldo
POST /api/v1/pacientes
POST /api/v1/consultas
POST /api/v1/descansos
POST /api/v1/certificados
POST /api/v1/recetas
POST /api/v1/documentos/generar</pre></body></html>`);
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
