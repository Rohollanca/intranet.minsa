# Guia Simple De Uso De API

La API usa una sola clave global:

```env
API_SHARED_KEY=YOUR_API_KEY
```

Entrega esa clave solo a integraciones autorizadas. Todas las rutas privadas deben enviar:

```http
Authorization: Bearer YOUR_API_KEY
```

## Rutas Disponibles

- `GET /api/v1/health`
- `GET /api/v1/openapi.json`
- `POST /api/v1/pacientes`
- `POST /api/v1/consultas`
- `POST /api/v1/descansos`
- `POST /api/v1/certificados`
- `POST /api/v1/recetas`
- `POST /api/v1/documentos/generar`

## Rutas Eliminadas

Ya no existen:

- `/api/v1/saldo`
- `/api/v1/admin/clientes`
- `/api/v1/admin/planes`
- `/api/v1/admin/metricas`
- `/api/v1/admin/uso`
- rutas de recarga o administracion de creditos

## Prueba Rapida

```bash
curl -X POST https://intranet-portalwebminsa.onrender.com/api/v1/pacientes \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dni":"75481714"}'
```

## Logs

Los logs simples se guardan en:

```env
API_USAGE_LOG_PATH=/var/data/api-usage.log
```

Respalda ese archivo si necesitas auditoria historica.
