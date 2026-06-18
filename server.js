import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const distDir = join(__dirname, 'dist');
const port = Number(process.env.PORT || 10000);
const medicalApiBaseUrl = (process.env.MEDICAL_API_BASE_URL || 'http://127.0.0.1:5055').replace(/\/$/, '');
const botFilesBaseUrl = (process.env.BOT_FILES_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

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
