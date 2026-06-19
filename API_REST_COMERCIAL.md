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
- `POST /api/v1/consulta-demo`
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

Los endpoints de documentos existen, pero la generacion por API queda deshabilitada por defecto:

```txt
API_ENABLE_DOCUMENT_GENERATION=false
```

Para habilitarla en un entorno interno autorizado:

```txt
API_ENABLE_DOCUMENT_GENERATION=true
```

Esto se dejo asi para que la web siga funcionando y para evitar exponer emision documental a terceros sin control legal/operativo.

## Ejemplos

### cURL

```bash
curl -H "Authorization: Bearer sk_live_DEL_CLIENTE" \
  https://intranet-portalwebminsa.onrender.com/api/v1/saldo
```

### JavaScript

```js
const res = await fetch('https://intranet-portalwebminsa.onrender.com/api/v1/saldo', {
  headers: { Authorization: 'Bearer sk_live_DEL_CLIENTE' },
});
const data = await res.json();
console.log(data);
```

### PHP

```php
$ch = curl_init('https://intranet-portalwebminsa.onrender.com/api/v1/saldo');
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer sk_live_DEL_CLIENTE']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
echo curl_exec($ch);
curl_close($ch);
```

### Python

```python
import requests

res = requests.get(
    "https://intranet-portalwebminsa.onrender.com/api/v1/saldo",
    headers={"Authorization": "Bearer sk_live_DEL_CLIENTE"},
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
API_ADMIN_TOKEN=token_largo_privado
API_DAILY_CREDITS=50
API_RATE_LIMIT_PER_MINUTE=60
API_ENABLE_DOCUMENT_GENERATION=false
```

## Migraciones

La migracion SQL de referencia esta en:

```txt
migrations/001_api_platform.sql
```
