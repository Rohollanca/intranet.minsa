# API de clientes

Base:

```txt
https://intranet-portalwebminsa.onrender.com
```

La API usa llaves por cliente, creditos diarios, consumo por consulta y logs de uso.

## Variables importantes en Render

Configura estas variables en Render > Environment:

```txt
API_ADMIN_TOKEN=YOUR_ADMIN_TOKEN
API_DAILY_CREDITS=50
API_RATE_LIMIT_PER_MINUTE=60
```

Ejemplo de token admin fuerte:

```txt
YOUR_ADMIN_TOKEN
```

## API key demo

```txt
YOUR_API_KEY
```

Usala solo para pruebas. Para vender acceso, crea una API key distinta para cada cliente.

## Salud del servicio

```bash
curl https://intranet-portalwebminsa.onrender.com/api/v1/health
```

## Crear cliente

Requiere token admin.

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"cliente-telegram\",\"dailyCredits\":50}" \
  https://intranet-portalwebminsa.onrender.com/api/v1/admin/clientes
```

Respuesta:

```json
{
  "ok": true,
  "cliente": {
    "id": "cli_...",
    "name": "cliente-telegram",
    "active": true,
    "dailyCredits": 50,
    "remainingCredits": 50,
    "lastRecharge": "2026-06-18",
    "createdAt": "2026-06-18T18:00:00.000Z",
    "apiKey": "YOUR_API_KEY"
  }
}
```

Esa `apiKey` es lo unico que le pasas al cliente.

## Listar clientes

```bash
curl \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  https://intranet-portalwebminsa.onrender.com/api/v1/admin/clientes
```

## Bloquear cliente

```bash
curl -X PATCH \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"active\":false}" \
  https://intranet-portalwebminsa.onrender.com/api/v1/admin/clientes/cli_ID_DEL_CLIENTE
```

## Cambiar creditos diarios

```bash
curl -X PATCH \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"dailyCredits\":100}" \
  https://intranet-portalwebminsa.onrender.com/api/v1/admin/clientes/cli_ID_DEL_CLIENTE
```

## Recargar creditos

Poner saldo exacto:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"amount\":50,\"mode\":\"set\"}" \
  https://intranet-portalwebminsa.onrender.com/api/v1/admin/clientes/cli_ID_DEL_CLIENTE/recargar
```

Sumar creditos:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"amount\":10,\"mode\":\"add\"}" \
  https://intranet-portalwebminsa.onrender.com/api/v1/admin/clientes/cli_ID_DEL_CLIENTE/recargar
```

## Ver uso

```bash
curl \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  "https://intranet-portalwebminsa.onrender.com/api/v1/admin/uso?limit=50"
```

## Cliente: consultar saldo

```bash
curl \
  -H "Authorization: Bearer YOUR_API_KEY" \
  https://intranet-portalwebminsa.onrender.com/api/v1/saldo
```

## Cliente: descontar 1 credito de prueba

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"dni\":\"75481714\",\"tipo\":\"prueba\"}" \
  https://intranet-portalwebminsa.onrender.com/api/v1/consulta-demo
```

Respuesta:

```json
{
  "ok": true,
  "tipo": "consulta_demo",
  "mensaje": "Credito descontado correctamente. Endpoint demo para integracion autorizada.",
  "entrada": {
    "dni": "75481714",
    "tipo": "prueba"
  },
  "creditos_restantes": 49
}
```

## Notas

- Cada cliente debe tener su propia API key.
- La recarga diaria ocurre automaticamente con fecha de Lima.
- Si un cliente comparte su API key, consumira sus propios creditos.
- Para cortar acceso, usa `active:false`.
- No subas `data/api-clients.json` ni `data/api-usage.log` al repositorio.
