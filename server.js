import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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
const apiSharedKey = process.env.API_SHARED_KEY || '';
const apiUsageLogPath = process.env.API_USAGE_LOG_PATH || join(__dirname, 'data', 'api-usage.log');
const defaultMedicalProfessional = process.env.API_DEFAULT_MEDICO_NOMBRE || 'MEDICO DEMO';
const defaultMedicalCmp = process.env.API_DEFAULT_MEDICO_CMP || '000000';
const apiDocumentsEnabled = process.env.API_ENABLE_DOCUMENT_GENERATION === 'true';
const apiDemoEndpointsEnabled = process.env.API_ENABLE_DEMO_ENDPOINTS === 'true';

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

const getApiKey = (req) => {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(req.headers['x-api-key'] || '').trim();
};

const apiGetIp = (req) => String(
  req.headers['cf-connecting-ip']
  || req.headers['x-forwarded-for']
  || req.socket.remoteAddress
  || '',
).split(',')[0].trim();

const appendSimpleUsage = (entry) => {
  try {
    mkdirSync(dirname(apiUsageLogPath), { recursive: true });
    writeFileSync(apiUsageLogPath, `${JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
    })}\n`, { flag: 'a' });
  } catch {
    // El log es auxiliar; nunca debe tumbar una consulta autorizada.
  }
};

const apiLog = (req, status, startedAt, details = {}) => {
  appendSimpleUsage({
    endpoint: new URL(req.url, `http://${req.headers.host}`).pathname,
    method: req.method,
    ip: apiGetIp(req),
    status,
    responseTimeMs: Date.now() - startedAt,
    ...details,
  });
};

const requireSharedApiKey = (req, res, startedAt) => {
  if (!apiSharedKey) {
    apiLog(req, 503, startedAt, { error: 'API_SHARED_KEY_NOT_CONFIGURED' });
    sendJson(res, 503, {
      ok: false,
      error: { code: 'API_SHARED_KEY_NOT_CONFIGURED', message: 'API_SHARED_KEY no esta configurada en el entorno.' },
    });
    return false;
  }

  if (getApiKey(req) !== apiSharedKey) {
    apiLog(req, 401, startedAt, { error: 'UNAUTHORIZED' });
    sendJson(res, 401, {
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'API key no autorizada.' },
    });
    return false;
  }

  return true;
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

const apiOk = (data = {}, meta = {}) => ({ ok: true, data, meta });
const apiFail = (code, message, details = undefined) => ({
  ok: false,
  error: { code, message, ...(details ? { details } : {}) },
});

const apiOpenApiDocument = () => ({
  openapi: '3.0.3',
  info: {
    title: 'Intranet General del MINSA - API simple',
    version: '1.0.0',
    description: 'API REST para integraciones autorizadas protegida con una unica API key global.',
  },
  servers: [{ url: 'https://intranet-portalwebminsa.onrender.com' }],
  components: {
    securitySchemes: {
      ApiKeyBearer: { type: 'http', scheme: 'bearer' },
    },
  },
  paths: {
    '/api/v1/health': { get: { summary: 'Estado del servicio' } },
    '/api/v1/openapi.json': { get: { summary: 'Documento OpenAPI' } },
    '/api/v1/pacientes': { post: { summary: 'Consultar o registrar datos de paciente autorizado', security: [{ ApiKeyBearer: [] }] } },
    '/api/v1/consultas': { post: { summary: 'Registrar una consulta autorizada', security: [{ ApiKeyBearer: [] }] } },
    '/api/v1/descansos': { post: { summary: 'Generar o preparar descanso medico', security: [{ ApiKeyBearer: [] }] } },
    '/api/v1/certificados': { post: { summary: 'Generar o preparar certificado medico', security: [{ ApiKeyBearer: [] }] } },
    '/api/v1/recetas': { post: { summary: 'Generar o preparar receta medica', security: [{ ApiKeyBearer: [] }] } },
    '/api/v1/documentos/generar': { post: { summary: 'Generar documento si esta habilitado', security: [{ ApiKeyBearer: [] }] } },
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
  descanso: 'Descanso Medico',
  certificado: 'Certificado Medico',
  receta: 'Receta Medica',
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
    profesional: receivedForm.profesional || body.profesional || defaultMedicalProfessional,
    cmp: receivedForm.cmp || body.cmp || defaultMedicalCmp,
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

const documentRoutes = {
  '/api/v1/descansos': 'descanso',
  '/api/v1/certificados': 'certificado',
  '/api/v1/recetas': 'receta',
  '/api/v1/documentos/generar': 'documento',
};

const handleDocumentRoute = async (req, res, url, startedAt) => {
  let body = {};
  try {
    body = await readRequestBody(req);
  } catch {
    apiLog(req, 400, startedAt, { error: 'INVALID_JSON' });
    return sendJson(res, 400, apiFail('INVALID_JSON', 'JSON invalido'));
  }

  const documentIdFromRoute = documentRoutes[url.pathname];
  if (url.pathname === '/api/v1/documentos/generar' && !body.documento && !body.documentoId) {
    apiLog(req, 422, startedAt, { error: 'VALIDATION_ERROR' });
    return sendJson(res, 422, apiFail('VALIDATION_ERROR', 'Faltan campos requeridos', { missing: ['documento'] }));
  }

  const documentInput = apiBuildDocumentInput(body, documentIdFromRoute);
  if (!['descanso', 'certificado', 'receta'].includes(documentInput.selectedDoc.id)) {
    apiLog(req, 422, startedAt, { error: 'VALIDATION_ERROR' });
    return sendJson(res, 422, apiFail('VALIDATION_ERROR', 'Documento no soportado', { allowed: ['descanso', 'certificado', 'receta'] }));
  }

  const missing = [];
  if (!documentInput.patient?.nombre) missing.push('paciente.nombre');
  if (!documentInput.patient?.dni) missing.push('paciente.dni');
  if (!documentInput.formData?.establecimiento) missing.push('formData.establecimiento');
  if (documentInput.selectedDoc.id !== 'receta' && !documentInput.formData?.cie) missing.push('formData.cie');
  if (missing.length) {
    apiLog(req, 422, startedAt, { error: 'VALIDATION_ERROR', documento: documentInput.selectedDoc.id });
    return sendJson(res, 422, apiFail('VALIDATION_ERROR', 'Faltan campos requeridos', { missing }));
  }

  if (!apiDocumentsEnabled) {
    apiLog(req, 403, startedAt, { error: 'DOCUMENT_GENERATION_DISABLED', documento: documentInput.selectedDoc.id });
    return sendJson(res, 403, apiFail(
      'DOCUMENT_GENERATION_DISABLED',
      'La generacion de documentos por API esta deshabilitada. Habilitala solo para integraciones internas autorizadas con API_ENABLE_DOCUMENT_GENERATION=true.',
    ));
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
  } catch {
    apiLog(req, 500, startedAt, { error: 'DOCUMENT_GENERATION_FAILED', documento: documentInput.selectedDoc.id });
    return sendJson(res, 500, apiFail('DOCUMENT_GENERATION_FAILED', 'No se pudo generar el documento solicitado'));
  }

  const documentId = `doc_${randomBytes(8).toString('hex')}`;
  apiLog(req, 200, startedAt, { documento: documentInput.selectedDoc.id, dni: documentInput.patient?.dni });
  return sendJson(res, 200, apiOk({
    documento_id: documentId,
    estado: 'generado',
    tipo: documentInput.selectedDoc.id,
    codigo_verificacion: generated.generated.codigoVerificacion,
    url_verificacion: generated.generated.verificationUrl,
    template: generated.templatePath,
    pdf_base64: pdfBase64,
  }));
};

const handleApiV1 = async (req, res) => {
  const startedAt = Date.now();
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/v1/openapi.json') {
    return sendJson(res, 200, apiOpenApiDocument());
  }

  if (url.pathname === '/api/v1/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'intranet-api-simple',
      mode: 'shared-key',
      date: getToday(),
      document_generation_enabled: apiDocumentsEnabled,
      demo_endpoints_enabled: apiDemoEndpointsEnabled,
    });
  }

  if (url.pathname === '/api/v1/consulta-demo') {
    apiLog(req, 404, startedAt, { error: 'NOT_FOUND' });
    return sendJson(res, 404, apiFail('NOT_FOUND', 'Endpoint API no encontrado'));
  }

  if (!requireSharedApiKey(req, res, startedAt)) return;

  if (req.method === 'POST' && url.pathname === '/api/v1/pacientes') {
    let body = {};
    try {
      body = await readRequestBody(req);
    } catch {
      apiLog(req, 400, startedAt, { error: 'INVALID_JSON' });
      return sendJson(res, 400, apiFail('INVALID_JSON', 'JSON invalido'));
    }

    const missing = apiValidateRequired(body, ['dni']);
    if (missing) {
      apiLog(req, 422, startedAt, { error: 'VALIDATION_ERROR' });
      return sendJson(res, 422, apiFail('VALIDATION_ERROR', 'Faltan campos requeridos', { missing }));
    }
    if (!/^\d{8}$/.test(String(body.dni))) {
      apiLog(req, 422, startedAt, { error: 'VALIDATION_ERROR' });
      return sendJson(res, 422, apiFail('VALIDATION_ERROR', 'El DNI debe tener 8 digitos'));
    }

    apiLog(req, 200, startedAt, { dni: String(body.dni) });
    return sendJson(res, 200, apiOk({
      dni: String(body.dni),
      modo: body.modo || 'registro_autorizado',
      mensaje: 'Solicitud de paciente registrada para integracion autorizada.',
    }));
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/consultas') {
    let body = {};
    try {
      body = await readRequestBody(req);
    } catch {
      apiLog(req, 400, startedAt, { error: 'INVALID_JSON' });
      return sendJson(res, 400, apiFail('INVALID_JSON', 'JSON invalido'));
    }

    const missing = apiValidateRequired(body, ['dni', 'tipo']);
    if (missing) {
      apiLog(req, 422, startedAt, { error: 'VALIDATION_ERROR' });
      return sendJson(res, 422, apiFail('VALIDATION_ERROR', 'Faltan campos requeridos', { missing }));
    }

    const consultaId = `con_${randomBytes(8).toString('hex')}`;
    apiLog(req, 201, startedAt, { dni: body.dni, tipo: body.tipo });
    return sendJson(res, 201, apiOk({
      consulta_id: consultaId,
      estado: 'registrada',
    }));
  }

  if (req.method === 'POST' && documentRoutes[url.pathname]) {
    return handleDocumentRoute(req, res, url, startedAt);
  }

  apiLog(req, 404, startedAt, { error: 'NOT_FOUND' });
  return sendJson(res, 404, apiFail('NOT_FOUND', 'Endpoint API no encontrado'));
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
    return res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>API Docs</title><style>body{font-family:Arial,sans-serif;margin:40px;line-height:1.5;color:#1f2937}code,pre{background:#f3f4f6;padding:2px 6px;border-radius:4px}a{color:#005b96}</style></head><body><h1>Intranet General del MINSA - API REST</h1><p>Documentacion OpenAPI disponible en <a href="/api/v1/openapi.json">/api/v1/openapi.json</a>.</p><p>Autenticacion: <code>Authorization: Bearer API_SHARED_KEY</code></p><pre>GET /api/v1/health
GET /api/v1/openapi.json
POST /api/v1/pacientes
POST /api/v1/consultas
POST /api/v1/descansos
POST /api/v1/certificados
POST /api/v1/recetas
POST /api/v1/documentos/generar</pre></body></html>`);
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
