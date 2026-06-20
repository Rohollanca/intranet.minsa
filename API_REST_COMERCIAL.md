# Plataforma API REST comercial

## Estado actual

La aplicacion web existente se mantiene igual. La API se agrego encima del servidor `server.js` sin mover la logica visual de React.

## Endpoints principales

Publicos:

- `GET /api/v1/health`
- `GET /api/v1/openapi.json`
- `GET /api/docs`

Cliente con API Key:

- `GET /api/v1/saldo`
- `POST /api/v1/pacientes`
- `POST /api/v1/consultas`
- `POST /api/v1/descansos`
- `POST /api/v1/certificados`
- `POST /api/v1/recetas`
- `POST /api/v1/documentos/generar`

Administrador:

- `GET /api/v1/admin/clientes`
- `POST /api/v1/admin/clientes`
- `PATCH /api/v1/admin/clientes/:id`
- `POST /api/v1/admin/clientes/:id/recargar`
- `GET /api/v1/admin/planes`
- `GET /api/v1/admin/metricas`
- `GET /api/v1/admin/uso`

## Seguridad

- Las API keys nuevas se generan aleatoriamente.
- En el almacenamiento se guarda `apiKeyHash`, no la key completa.
- La key completa solo se devuelve una vez al crear el cliente.
- Cada solicitud usa `Authorization: Bearer API_KEY`.
- El administrador usa `API_ADMIN_TOKEN`.
- Las respuestas evitan mostrar errores internos sensibles.

## Planes

- `free`: 10 creditos diarios, 20 req/min, sin documentos.
- `basic`: 50 creditos diarios, 60 req/min.
- `professional`: 250 creditos diarios, 120 req/min, documentos autorizados.
- `enterprise`: 1000 creditos diarios, 300 req/min.

## Generacion de documentos

Los endpoints de documentos reutilizan el mismo `documentService` que usa la web para crear el DOCX desde las plantillas oficiales y luego convierten ese DOCX usando el mismo servicio existente `convert-docx-to-pdf`.

La generacion por API queda deshabilitada por defecto:

```txt
API_ENABLE_DOCUMENT_GENERATION=false
```

Para habilitarla en un entorno interno autorizado:

```txt
API_ENABLE_DOCUMENT_GENERATION=true
```

Esto se dejo asi para que la web siga funcionando y para evitar exponer emision documental a terceros sin control legal/operativo.

Cuando se habilita, la API:

1. Valida API key, plan y permiso `documentos`.
2. Valida datos minimos del paciente y formulario.
3. Usa `createOfficialDocument()` para generar el DOCX con las mismas plantillas de la web.
4. Envia el DOCX al conversor existente.
5. Devuelve `pdf_base64`, codigo de verificacion y creditos restantes.

## Ejemplos

### cURL

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://intranet-portalwebminsa.onrender.com/api/v1/saldo
```

### JavaScript

```js
const res = await fetch('https://intranet-portalwebminsa.onrender.com/api/v1/saldo', {
  headers: { Authorization: 'Bearer YOUR_API_KEY' },
});
const data = await res.json();
console.log(data);
```

### PHP

```php
$ch = curl_init('https://intranet-portalwebminsa.onrender.com/api/v1/saldo');
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer YOUR_API_KEY']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
echo curl_exec($ch);
curl_close($ch);
```

### Python

```python
import requests

res = requests.get(
    "https://intranet-portalwebminsa.onrender.com/api/v1/saldo",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    timeout=30,
)
print(res.json())
```

## Instalacion

```bash
npm install
npm run build
npm start
```

## Despliegue en Render

Variables recomendadas:

```txt
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DATABASE
PGSSLMODE=require
API_ADMIN_TOKEN=YOUR_ADMIN_TOKEN
API_DAILY_CREDITS=50
API_RATE_LIMIT_PER_MINUTE=60
API_ENABLE_DOCUMENT_GENERATION=false
API_ENABLE_DEMO_ENDPOINTS=false
```

## PostgreSQL

En produccion la API usa PostgreSQL para clientes, hashes de API keys, planes, creditos, rate limits y logs.

1. Configura `DATABASE_URL` en Render.
2. Ejecuta las migraciones:

```bash
npm run db:migrate
```

3. Si ya tenias datos locales en `data/api-clients.json` y `data/api-usage.log`, importalos:

```bash
npm run db:migrate:json
```

Si `DATABASE_URL` no existe, el servidor mantiene el modo local con archivos JSON para desarrollo.

## Prueba real con PostgreSQL

1. Crea una base PostgreSQL y copia su cadena de conexion en `DATABASE_URL`:

```bash
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DATABASE
PGSSLMODE=require
```

2. Crea o actualiza las tablas y planes:

```bash
npm run db:migrate
```

3. Si existen `data/api-clients.json` o `data/api-usage.log`, importalos una sola vez:

```bash
npm run db:migrate:json
```

4. Inicia el servicio y verifica salud:

```bash
npm start
curl http://127.0.0.1:10000/api/v1/health
```

5. Crea un cliente usando `YOUR_ADMIN_TOKEN` y conserva la `apiKey` devuelta:

```bash
curl -X POST http://127.0.0.1:10000/api/v1/admin/clientes \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"validacion-postgres","planId":"basic","dailyCredits":50}'
```

6. Consulta el saldo, consume un credito mediante el endpoint comercial de pacientes y vuelve a consultar:

```bash
curl http://127.0.0.1:10000/api/v1/saldo \
  -H "Authorization: Bearer YOUR_API_KEY"

curl -X POST http://127.0.0.1:10000/api/v1/pacientes \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dni":"75481714"}'

curl http://127.0.0.1:10000/api/v1/saldo \
  -H "Authorization: Bearer YOUR_API_KEY"
```

El segundo saldo debe ser exactamente un credito menor y los registros deben aparecer en `api_usage_logs`.

`API_ENABLE_DEMO_ENDPOINTS` debe permanecer en `false` en produccion. Con ese valor, `/api/v1/consulta-demo` responde 404 y no aparece en OpenAPI.

## Migraciones

La migracion SQL de referencia esta en:

```txt
migrations/001_api_platform.sql
```
