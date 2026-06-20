# API REST Simple

Esta API expone funciones controladas del sistema medico usando una sola clave global.

La web principal sigue funcionando igual. La API no usa clientes, planes, creditos, suscripciones ni PostgreSQL.

## Seguridad

Configura una clave segura en el entorno:

```env
API_SHARED_KEY=YOUR_API_KEY
API_ENABLE_DOCUMENT_GENERATION=false
API_ENABLE_DEMO_ENDPOINTS=false
```

Todas las rutas privadas requieren:

```http
Authorization: Bearer YOUR_API_KEY
```

## Endpoints

Publicos:

- `GET /api/v1/health`
- `GET /api/v1/openapi.json`

Privados:

- `POST /api/v1/pacientes`
- `POST /api/v1/consultas`
- `POST /api/v1/descansos`
- `POST /api/v1/certificados`
- `POST /api/v1/recetas`
- `POST /api/v1/documentos/generar`

No existe `/api/v1/saldo` porque ya no hay creditos.

No existen endpoints admin de clientes, planes, metricas comerciales ni recargas.

## Generacion De Documentos

La generacion por API permanece apagada por defecto:

```env
API_ENABLE_DOCUMENT_GENERATION=false
```

Con ese valor, los endpoints de documentos responden `403 DOCUMENT_GENERATION_DISABLED`.

Para habilitarla solo en una integracion autorizada:

```env
API_ENABLE_DOCUMENT_GENERATION=true
```

Los documentos usan el mismo `createOfficialDocument()` y las mismas plantillas que la web.

## Logs Simples

Configura opcionalmente:

```env
API_USAGE_LOG_PATH=/var/data/api-usage.log
```

Cada solicitud privada registra una linea JSON con:

- fecha
- endpoint
- metodo
- IP
- status
- tiempo de respuesta

## Ejemplos

### Health

```bash
curl https://intranet-portalwebminsa.onrender.com/api/v1/health
```

### Paciente

```bash
curl -X POST https://intranet-portalwebminsa.onrender.com/api/v1/pacientes \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dni":"75481714"}'
```

### Consulta

```bash
curl -X POST https://intranet-portalwebminsa.onrender.com/api/v1/consultas \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dni":"75481714","tipo":"reniec"}'
```

### Documento

```bash
curl -X POST https://intranet-portalwebminsa.onrender.com/api/v1/documentos/generar \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "documento":"receta",
    "paciente":{"nombre":"PACIENTE DEMO","dni":"75481714"},
    "formData":{"establecimiento":"HOSPITAL DEMO","medicamentos":[]}
  }'
```

## Render

Variables minimas:

```env
API_SHARED_KEY=YOUR_API_KEY
API_ENABLE_DOCUMENT_GENERATION=false
API_ENABLE_DEMO_ENDPOINTS=false
API_USAGE_LOG_PATH=/var/data/api-usage.log
```

Si usas logs persistentes en Render, crea un Disk montado en:

```txt
/var/data
```
