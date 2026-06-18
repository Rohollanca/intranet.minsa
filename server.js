import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const defaultApiKey = process.env.API_DEFAULT_KEY || 'sk_medico_090558';
const defaultDailyCredits = Number(process.env.API_DAILY_CREDITS || 50);

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
    return handleApiV1(req, res);
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
